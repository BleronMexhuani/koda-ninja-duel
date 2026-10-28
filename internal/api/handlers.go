package api

import (
	cryptorand "crypto/rand"
	"encoding/binary"
	"errors"
	"fmt"
	"math/rand/v2"
	"net/http"
	"regexp"
	"strings"

	"github.com/BleronMexhuani/koda-ninja-duel/internal/game"
	"github.com/BleronMexhuani/koda-ninja-duel/internal/store"
)

// ---------- auth ----------

type credentials struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

func (s *Server) register(w http.ResponseWriter, r *http.Request) {
	var c credentials
	if err := readJSON(r, &c); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	c.Username = strings.TrimSpace(c.Username)
	if err := validateCredentials(c.Username, c.Password); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	hash, err := hashPassword(c.Password)
	if err != nil {
		s.internal(w, err)
		return
	}
	p, err := s.st.CreatePlayer(r.Context(), c.Username, hash)
	if errors.Is(err, store.ErrUsernameTaken) {
		writeErr(w, http.StatusConflict, err.Error())
		return
	}
	if err != nil {
		s.internal(w, err)
		return
	}
	s.startSession(w, r, p)
}

func (s *Server) login(w http.ResponseWriter, r *http.Request) {
	var c credentials
	if err := readJSON(r, &c); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	p, err := s.st.PlayerByUsername(r.Context(), strings.TrimSpace(c.Username))
	if err != nil && !errors.Is(err, store.ErrNotFound) {
		s.internal(w, err)
		return
	}
	if p == nil {
		checkPassword(dummyHash, c.Password)
		writeErr(w, http.StatusUnauthorized, "wrong username or password")
		return
	}
	if !checkPassword(p.PasswordHash(), c.Password) {
		writeErr(w, http.StatusUnauthorized, "wrong username or password")
		return
	}
	s.startSession(w, r, p)
}

func (s *Server) startSession(w http.ResponseWriter, r *http.Request, p *store.Player) {
	token, hash, err := newToken()
	if err != nil {
		s.internal(w, err)
		return
	}
	if err := s.st.CreateSession(r.Context(), hash, p.ID, sessionTTL); err != nil {
		s.internal(w, err)
		return
	}
	s.setSessionCookie(w, token, int(sessionTTL.Seconds()))
	writeJSON(w, http.StatusOK, map[string]any{"player": p})
}

func (s *Server) logout(w http.ResponseWriter, r *http.Request) {
	if c, err := r.Cookie(cookieName); err == nil && c.Value != "" {
		if err := s.st.DeleteSession(r.Context(), tokenHash(c.Value)); err != nil {
			s.internal(w, err)
			return
		}
	}
	s.setSessionCookie(w, "", -1)
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// ---------- profile ----------

type techniqueView struct {
	game.Technique
	Owned       bool   `json:"owned"`
	Rank        int    `json:"rank"`
	Slot        *int   `json:"slot"`
	UpgradeCost int    `json:"upgradeCost"`
	Locked      bool   `json:"locked"`
	LockReason  string `json:"lockReason,omitempty"`
}

type missionView struct {
	game.Mission
	EnemyInfo  game.Enemy `json:"enemyInfo"`
	Unlocked   bool       `json:"unlocked"`
	LockReason string     `json:"lockReason,omitempty"`
	Clears     int        `json:"clears"`
	BestTurns  *int       `json:"bestTurns"`
}

func missionName(id string) string {
	if m, ok := game.MissionByID(id); ok {
		return m.Name
	}
	return id
}

func lockFor(level int, progress map[string]store.Progress, reqLevel int, reqMission string) string {
	if level < reqLevel {
		return fmt.Sprintf("Reach level %d", reqLevel)
	}
	if reqMission != "" && progress[reqMission].Clears == 0 {
		return fmt.Sprintf("Clear “%s”", missionName(reqMission))
	}
	return ""
}

func (s *Server) me(w http.ResponseWriter, r *http.Request, p *store.Player) {
	ctx := r.Context()
	owned, err := s.st.Techniques(ctx, p.ID)
	if err != nil {
		s.internal(w, err)
		return
	}
	progress, err := s.st.Progress(ctx, p.ID)
	if err != nil {
		s.internal(w, err)
		return
	}
	techs := []techniqueView{}
	for _, t := range game.ShopTechniques() {
		v := techniqueView{Technique: t}
		if o, ok := owned[t.ID]; ok {
			v.Owned, v.Rank, v.Slot = true, o.Rank, o.Slot
			if o.Rank < game.MaxRank {
				v.UpgradeCost = game.UpgradeCost(t, o.Rank)
			}
		} else if reason := lockFor(p.Level, progress, t.ReqLevel, t.ReqMission); reason != "" {
			v.Locked, v.LockReason = true, reason
		}
		techs = append(techs, v)
	}
	missions := []missionView{}
	for _, m := range game.Missions {
		v := missionView{Mission: m, EnemyInfo: game.Enemies[m.Enemy], Clears: progress[m.ID].Clears, BestTurns: progress[m.ID].BestTurns}
		v.LockReason = lockFor(p.Level, progress, m.ReqLevel, m.ReqMission)
		v.Unlocked = v.LockReason == ""
		missions = append(missions, v)
	}
	type activeView struct {
		ID      string `json:"id"`
		Mission string `json:"mission"`
		Enemy   string `json:"enemy"`
	}
	var active *activeView
	if b, err := s.st.ActiveBattle(ctx, p.ID); err == nil {
		active = &activeView{ID: b.ID, Mission: b.MissionID, Enemy: b.State.E.Name}
	} else if !errors.Is(err, store.ErrNotFound) {
		s.internal(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"player": p, "techniques": techs, "missions": missions, "activeBattle": active,
		"allTechniques": game.Techniques, "maxSlots": game.MaxSlots, "maxRank": game.MaxRank,
	})
}

// ---------- shop & loadout ----------

func (s *Server) buy(w http.ResponseWriter, r *http.Request, p *store.Player) {
	var body struct {
		Technique string `json:"technique"`
	}
	if err := readJSON(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	t, ok := game.Techniques[body.Technique]
	if !ok || !t.Shop || t.Starter {
		writeErr(w, http.StatusNotFound, "that technique is not for sale")
		return
	}
	progress, err := s.st.Progress(r.Context(), p.ID)
	if err != nil {
		s.internal(w, err)
		return
	}
	if reason := lockFor(p.Level, progress, t.ReqLevel, t.ReqMission); reason != "" {
		writeErr(w, http.StatusForbidden, "locked: "+reason)
		return
	}
	switch err := s.st.Buy(r.Context(), p.ID, t); {
	case errors.Is(err, store.ErrNoFunds), errors.Is(err, store.ErrOwned):
		writeErr(w, http.StatusConflict, err.Error())
	case err != nil:
		s.internal(w, err)
	default:
		writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
	}
}

func (s *Server) upgrade(w http.ResponseWriter, r *http.Request, p *store.Player) {
	t, ok := game.Techniques[r.PathValue("id")]
	if !ok || !t.Shop {
		writeErr(w, http.StatusNotFound, "no such technique")
		return
	}
	rank, err := s.st.Upgrade(r.Context(), p.ID, t)
	switch {
	case errors.Is(err, store.ErrNotFound):
		writeErr(w, http.StatusNotFound, "you don't own that technique")
	case errors.Is(err, store.ErrNoFunds), errors.Is(err, store.ErrMaxRank):
		writeErr(w, http.StatusConflict, err.Error())
	case err != nil:
		s.internal(w, err)
	default:
		writeJSON(w, http.StatusOK, map[string]int{"rank": rank})
	}
}

func (s *Server) setLoadout(w http.ResponseWriter, r *http.Request, p *store.Player) {
	var body struct {
		Slots []string `json:"slots"`
	}
	if err := readJSON(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	if len(body.Slots) == 0 || len(body.Slots) > game.MaxSlots {
		writeErr(w, http.StatusBadRequest, fmt.Sprintf("equip between 1 and %d techniques", game.MaxSlots))
		return
	}
	seen := map[string]bool{}
	for _, id := range body.Slots {
		if seen[id] {
			writeErr(w, http.StatusBadRequest, "each technique can only be equipped once")
			return
		}
		seen[id] = true
	}
	if err := s.st.SetLoadout(r.Context(), p.ID, body.Slots); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// ---------- battles ----------

var uuidRe = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)

func newRNG() *rand.Rand {
	var b [16]byte
	_, _ = cryptorand.Read(b[:])
	return rand.New(rand.NewPCG(binary.LittleEndian.Uint64(b[:8]), binary.LittleEndian.Uint64(b[8:])))
}

type battleView struct {
	ID      string      `json:"id"`
	Mission string      `json:"mission"`
	State   *game.State `json:"state"`
}

func (s *Server) startBattle(w http.ResponseWriter, r *http.Request, p *store.Player) {
	var body struct {
		Mission string `json:"mission"`
	}
	if err := readJSON(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	m, ok := game.MissionByID(body.Mission)
	if !ok {
		writeErr(w, http.StatusNotFound, "no such mission")
		return
	}
	ctx := r.Context()
	progress, err := s.st.Progress(ctx, p.ID)
	if err != nil {
		s.internal(w, err)
		return
	}
	if reason := lockFor(p.Level, progress, m.ReqLevel, m.ReqMission); reason != "" {
		writeErr(w, http.StatusForbidden, "locked: "+reason)
		return
	}
	loadout, err := s.st.Loadout(ctx, p.ID)
	if err != nil {
		s.internal(w, err)
		return
	}
	b, err := game.NewBattle(m, p.Level, loadout, newRNG())
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	id, err := s.st.StartBattle(ctx, p.ID, b.S)
	if err != nil {
		s.internal(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"battle": battleView{id, m.Name, b.S}, "events": b.Events})
}

func (s *Server) activeBattle(w http.ResponseWriter, r *http.Request, p *store.Player) {
	b, err := s.st.ActiveBattle(r.Context(), p.ID)
	if errors.Is(err, store.ErrNotFound) {
		writeErr(w, http.StatusNotFound, "no battle in progress")
		return
	}
	if err != nil {
		s.internal(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"battle": battleView{b.ID, missionName(b.MissionID), &b.State}})
}

func (s *Server) turn(w http.ResponseWriter, r *http.Request, p *store.Player) {
	var body struct {
		Move string `json:"move"`
	}
	if err := readJSON(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	s.advance(w, r, p, func(b *game.Battle) error { return b.PlayerMove(body.Move) })
}

func (s *Server) forfeit(w http.ResponseWriter, r *http.Request, p *store.Player) {
	s.advance(w, r, p, func(b *game.Battle) error { b.Forfeit(); return nil })
}

// advance loads the battle, applies fn, settles rewards if it ended, and
// returns the events for the client to animate.
func (s *Server) advance(w http.ResponseWriter, r *http.Request, p *store.Player, fn func(*game.Battle) error) {
	var (
		events  []game.Event
		reward  *game.Reward
		state   *game.State
		name    string
		moveErr error
	)
	id := r.PathValue("id")
	if !uuidRe.MatchString(id) {
		writeErr(w, http.StatusNotFound, "that battle is not running")
		return
	}
	err := s.st.WithBattle(r.Context(), p.ID, id, func(row *store.BattleRow, firstClear bool, xpBefore int) (*store.Settlement, error) {
		b := game.Load(&row.State, newRNG())
		if err := fn(b); err != nil {
			moveErr = err
			return nil, err
		}
		events, state, name = b.Events, b.S, missionName(row.MissionID)
		if b.S.Phase != "over" {
			return nil, nil
		}
		m, _ := game.MissionByID(row.MissionID)
		won := b.S.Winner == "p"
		rw := game.RewardFor(m, won, won && firstClear, xpBefore)
		reward = &rw
		return &store.Settlement{Won: won, Ryo: rw.Ryo, XP: rw.XP, Turns: b.S.Turn}, nil
	})
	switch {
	case moveErr != nil:
		writeErr(w, http.StatusConflict, moveErr.Error())
		return
	case errors.Is(err, store.ErrNotFound):
		writeErr(w, http.StatusNotFound, "that battle is not running")
		return
	case err != nil:
		s.internal(w, err)
		return
	}
	resp := map[string]any{"battle": battleView{id, name, state}, "events": events}
	if reward != nil {
		resp["reward"] = reward
		if fresh, err := s.st.PlayerByID(r.Context(), p.ID); err == nil {
			resp["player"] = fresh
		}
	}
	writeJSON(w, http.StatusOK, resp)
}

func (s *Server) leaderboard(w http.ResponseWriter, r *http.Request, p *store.Player) {
	rows, err := s.st.Leaderboard(r.Context(), 20)
	if err != nil {
		s.internal(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"rows": rows, "you": p.Username})
}
