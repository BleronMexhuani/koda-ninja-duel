package game

import (
	"errors"
	"fmt"
	"math"
	"math/rand/v2"
)

// Status effects on a fighter.
type Status struct {
	Burn     int  `json:"burn"`
	Stun     bool `json:"stun"`
	Guard    bool `json:"guard"`
	Charging bool `json:"charging"`
	Smoke    bool `json:"smoke"`
}

// MoveSlot is a technique a fighter brings into battle, with its rank.
type MoveSlot struct {
	ID   string `json:"id"`
	Rank int    `json:"rank"`
}

// Fighter is one side of a battle.
type Fighter struct {
	Side      string         `json:"side"` // "p" or "e"
	Kind      string         `json:"kind"` // "koda" or an enemy id
	Name      string         `json:"name"`
	Title     string         `json:"title,omitempty"`
	Style     string         `json:"style"`
	Palette   string         `json:"palette"`
	MaxHP     int            `json:"maxHp"`
	HP        int            `json:"hp"`
	Energy    int            `json:"energy"`
	Power     float64        `json:"power"`
	Counter   int            `json:"counter"`
	Status    Status         `json:"status"`
	Cooldowns map[string]int `json:"cooldowns"`
	Moves     []MoveSlot     `json:"moves"`
}

// State is everything needed to continue a battle. It is stored as JSON.
type State struct {
	MissionID string  `json:"missionId"`
	Turn      int     `json:"turn"`
	Phase     string  `json:"phase"` // "player" or "over"
	Winner    string  `json:"winner,omitempty"`
	P         Fighter `json:"p"`
	E         Fighter `json:"e"`
}

// Hit is one landed (or missed) blow, in the order the client should animate it.
type Hit struct {
	Target      string `json:"target"`
	Amount      int    `json:"amount"`
	Crit        bool   `json:"crit,omitempty"`
	Guarded     bool   `json:"guarded,omitempty"`
	Miss        bool   `json:"miss,omitempty"`
	Burn        int    `json:"burn,omitempty"`
	Stun        bool   `json:"stun,omitempty"`
	Drain       int    `json:"drain,omitempty"`
	Broke       bool   `json:"broke,omitempty"`
	ShieldBreak bool   `json:"shieldBreak,omitempty"`
	Counter     int    `json:"counter,omitempty"`
	Shock       int    `json:"shock,omitempty"`
}

// Heal restores health to one side.
type Heal struct {
	Target string `json:"target"`
	Amount int    `json:"amount"`
}

// FighterSnap is the part of a fighter that changes during a battle.
type FighterSnap struct {
	HP        int            `json:"hp"`
	Energy    int            `json:"energy"`
	Status    Status         `json:"status"`
	Cooldowns map[string]int `json:"cooldowns"`
}

// Snapshot of both fighters after an event.
type Snapshot struct {
	P FighterSnap `json:"p"`
	E FighterSnap `json:"e"`
}

// Event is something the client plays back, in order.
type Event struct {
	Kind       string    `json:"kind"` // turnStart, move, skip, end
	Actor      string    `json:"actor,omitempty"`
	Turn       int       `json:"turn,omitempty"`
	Move       string    `json:"move,omitempty"`
	Gain       int       `json:"gain,omitempty"`
	BurnTick   int       `json:"burnTick,omitempty"`
	GuardEnded bool      `json:"guardEnded,omitempty"`
	Evaded     bool      `json:"evaded,omitempty"`
	Cleansed   bool      `json:"cleansed,omitempty"`
	Hits       []Hit     `json:"hits,omitempty"`
	Heals      []Heal    `json:"heals,omitempty"`
	Winner     string    `json:"winner,omitempty"`
	Snap       *Snapshot `json:"snap,omitempty"`
}

// Battle wraps a state with a random source and an event log for one request.
type Battle struct {
	S      *State
	rng    *rand.Rand
	Events []Event
	evade  bool
}

// ErrNotYourTurn and friends are returned for invalid player input.
var (
	ErrOver        = errors.New("this battle is already over")
	ErrUnknownMove = errors.New("that technique is not in your loadout")
	ErrCannotUse   = errors.New("not enough energy, or the technique is still recovering")
)

// NewBattle builds the opening state for a mission. The returned events cover
// the player's first turn start.
func NewBattle(m Mission, playerLevel int, loadout []MoveSlot, rng *rand.Rand) (*Battle, error) {
	en, ok := Enemies[m.Enemy]
	if !ok {
		return nil, fmt.Errorf("unknown enemy %q", m.Enemy)
	}
	if len(loadout) == 0 {
		return nil, errors.New("equip at least one technique")
	}
	maxHP := MaxHPForLevel(playerLevel)
	emoves := make([]MoveSlot, 0, len(en.Moves))
	for _, id := range en.Moves {
		emoves = append(emoves, MoveSlot{ID: id, Rank: 1})
	}
	s := &State{
		MissionID: m.ID, Turn: 1, Phase: "player",
		P: Fighter{Side: "p", Kind: "koda", Name: "Koda", Style: "ninja", Palette: "koda", MaxHP: maxHP, HP: maxHP, Energy: 18, Power: 1, Counter: 4, Cooldowns: map[string]int{}, Moves: loadout},
		E: Fighter{Side: "e", Kind: en.ID, Name: en.Name, Title: en.Title, Style: en.Style, Palette: en.Palette, MaxHP: en.MaxHP, HP: en.MaxHP, Energy: en.Energy, Power: en.Power, Cooldowns: map[string]int{}, Moves: emoves},
	}
	b := &Battle{S: s, rng: rng}
	b.turnStart(&s.P)
	return b, nil
}

// Load wraps an existing state.
func Load(s *State, rng *rand.Rand) *Battle {
	if s.P.Cooldowns == nil {
		s.P.Cooldowns = map[string]int{}
	}
	if s.E.Cooldowns == nil {
		s.E.Cooldowns = map[string]int{}
	}
	return &Battle{S: s, rng: rng}
}

func (b *Battle) side(f *Fighter) *Fighter {
	if f.Side == "p" {
		return &b.S.E
	}
	return &b.S.P
}

func (b *Battle) snap() *Snapshot {
	cp := func(f *Fighter) FighterSnap {
		cd := map[string]int{}
		for k, v := range f.Cooldowns {
			if v > 0 {
				cd[k] = v
			}
		}
		return FighterSnap{HP: f.HP, Energy: f.Energy, Status: f.Status, Cooldowns: cd}
	}
	return &Snapshot{P: cp(&b.S.P), E: cp(&b.S.E)}
}

func (b *Battle) push(e Event) {
	e.Snap = b.snap()
	e.Turn = b.S.Turn
	b.Events = append(b.Events, e)
}

// CanUse reports whether a fighter can afford a technique right now.
func CanUse(f *Fighter, id string) bool {
	t, ok := Techniques[id]
	if !ok {
		return false
	}
	return f.Energy >= t.Cost && f.Cooldowns[id] <= 0
}

func rankOf(f *Fighter, id string) (int, bool) {
	for _, m := range f.Moves {
		if m.ID == id {
			return m.Rank, true
		}
	}
	return 0, false
}

// PlayerMove resolves the player's choice and then plays the enemy until it is
// the player's turn again or the battle ends.
func (b *Battle) PlayerMove(id string) error {
	s := b.S
	if s.Phase != "player" {
		return ErrOver
	}
	if _, ok := rankOf(&s.P, id); !ok {
		return ErrUnknownMove
	}
	if !CanUse(&s.P, id) {
		return ErrCannotUse
	}
	b.perform(&s.P, &s.E, id)
	if b.checkOver() {
		return nil
	}
	for guard := 0; guard < 8; guard++ { // stun chains are short; this is a safety bound
		b.turnStart(&s.E)
		if b.checkOver() {
			return nil
		}
		if s.E.Status.Stun {
			s.E.Status.Stun = false
			b.push(Event{Kind: "skip", Actor: "e"})
		} else {
			mv := "thunderfall"
			if !s.E.Status.Charging {
				mv = b.aiChoose()
			}
			b.perform(&s.E, &s.P, mv)
			if b.checkOver() {
				return nil
			}
		}
		s.Turn++
		b.turnStart(&s.P)
		if b.checkOver() {
			return nil
		}
		if s.P.Status.Stun {
			s.P.Status.Stun = false
			b.push(Event{Kind: "skip", Actor: "p"})
			continue
		}
		return nil
	}
	return nil
}

// Forfeit ends the battle as a loss.
func (b *Battle) Forfeit() {
	if b.S.Phase == "over" {
		return
	}
	b.S.Phase, b.S.Winner = "over", "e"
	b.push(Event{Kind: "end", Winner: "e"})
}

func (b *Battle) checkOver() bool {
	s := b.S
	if s.Phase == "over" {
		return true
	}
	if s.P.HP > 0 && s.E.HP > 0 {
		return false
	}
	s.Phase = "over"
	s.Winner = "p"
	if s.P.HP <= 0 {
		s.Winner = "e"
	}
	s.P.Status, s.E.Status = Status{}, Status{}
	b.push(Event{Kind: "end", Winner: s.Winner})
	return true
}

func (b *Battle) turnStart(f *Fighter) {
	ev := Event{Kind: "turnStart", Actor: f.Side}
	if f.Status.Guard {
		f.Status.Guard = false
		ev.GuardEnded = true
	}
	f.Status.Smoke = false
	before := f.Energy
	f.Energy = min(100, f.Energy+12)
	ev.Gain = f.Energy - before
	for k, v := range f.Cooldowns {
		if v > 0 {
			f.Cooldowns[k] = v - 1
		}
	}
	if f.Status.Burn > 0 {
		f.Status.Burn--
		f.HP = max(0, f.HP-6)
		ev.BurnTick = 6
	}
	b.push(ev)
}

func (b *Battle) roll(a *Fighter, rank, lo, hi int, canCrit bool) (int, bool) {
	base := float64(lo + b.rng.IntN(hi-lo+1))
	v := base * a.Power * RankMultiplier(rank)
	crit := canCrit && b.rng.Float64() < .1
	if crit {
		v *= 1.5
	}
	return int(math.Round(v)), crit
}

type hitOpts struct {
	melee, pierce, halfPierce, interrupt, shieldBreak bool
	burn, drain                                       int
	stun                                              float64
}

func (b *Battle) hit(a, d *Fighter, amt int, crit bool, o hitOpts) Hit {
	h := Hit{Target: d.Side, Crit: crit}
	if d.HP <= 0 {
		h.Miss = true
		return h
	}
	if b.evade {
		h.Miss = true
		return h
	}
	if o.shieldBreak && d.Status.Guard {
		d.Status.Guard = false
		h.ShieldBreak = true
	}
	if d.Status.Guard && !o.pierce {
		f := .3
		if o.halfPierce {
			f = .6
		}
		amt = max(1, int(math.Round(float64(amt)*f)))
		h.Guarded = true
	}
	if d.Status.Charging && o.interrupt {
		d.Status.Charging = false
		h.Broke = true
	}
	d.HP = max(0, d.HP-amt)
	h.Amount = amt
	if !h.Guarded && d.HP > 0 {
		if o.burn > 0 {
			d.Status.Burn = max(d.Status.Burn, o.burn)
			h.Burn = o.burn
		}
		if o.stun > 0 && b.rng.Float64() < o.stun {
			d.Status.Stun = true
			h.Stun = true
		}
	}
	if o.drain > 0 {
		dr := o.drain
		if h.Guarded {
			dr /= 2
		}
		dr = min(dr, d.Energy)
		d.Energy -= dr
		h.Drain = dr
	}
	if o.melee && d.HP > 0 {
		if h.Guarded && d.Counter > 0 {
			a.HP = max(0, a.HP-d.Counter)
			h.Counter = d.Counter
		}
		if d.Status.Charging && !h.Broke {
			a.HP = max(0, a.HP-3)
			h.Shock = 3
		}
	}
	return h
}

func (b *Battle) heal(f *Fighter, n int) Heal {
	before := f.HP
	f.HP = min(f.MaxHP, f.HP+n)
	return Heal{Target: f.Side, Amount: f.HP - before}
}

func (b *Battle) perform(a, d *Fighter, id string) {
	t := Techniques[id]
	rank, ok := rankOf(a, id)
	if !ok {
		rank = 1
	}
	a.Energy -= t.Cost
	if t.Cooldown > 0 {
		a.Cooldowns[id] = t.Cooldown + 1
	}
	ev := Event{Kind: "move", Actor: a.Side, Move: id}
	b.evade = false
	if t.Attack && d.Status.Smoke {
		d.Status.Smoke = false
		if b.rng.Float64() < .7 {
			b.evade = true
			ev.Evaded = true
		}
	}
	add := func(h Hit) { ev.Hits = append(ev.Hits, h) }

	switch id {
	case "strike":
		v, c := b.roll(a, rank, 10, 13, true)
		h1 := int(math.Round(float64(v) * .55))
		add(b.hit(a, d, h1, c, hitOpts{melee: true}))
		add(b.hit(a, d, v-h1, c, hitOpts{melee: true}))
	case "shuriken":
		for i := 0; i < 3; i++ {
			v, _ := b.roll(a, rank, 5, 6, false)
			add(b.hit(a, d, v, false, hitOpts{halfPierce: true, interrupt: true}))
		}
	case "fireball":
		v, c := b.roll(a, rank, 22, 27, true)
		add(b.hit(a, d, v, c, hitOpts{burn: 2}))
	case "guard", "barrier":
		a.Status.Guard = true
	case "smoke":
		a.Status.Smoke = true
	case "meditate":
		ev.Heals = append(ev.Heals, b.heal(a, int(math.Round(18*RankMultiplier(rank)))))
		if a.Status.Burn > 0 {
			a.Status.Burn = 0
			ev.Cleansed = true
		}
	case "windblade":
		v, c := b.roll(a, rank, 16, 20, true)
		add(b.hit(a, d, v, c, hitOpts{shieldBreak: true}))
	case "phoenix":
		v, c := b.roll(a, rank, 42, 50, true)
		add(b.hit(a, d, v, c, hitOpts{pierce: true, burn: 3}))
	case "thunderpalm":
		v, c := b.roll(a, rank, 28, 34, true)
		add(b.hit(a, d, v, c, hitOpts{melee: true, interrupt: true, stun: .3}))
	case "staff":
		v, c := b.roll(a, rank, 9, 12, true)
		add(b.hit(a, d, v, c, hitOpts{melee: true}))
	case "bolt":
		v, c := b.roll(a, rank, 18, 24, true)
		add(b.hit(a, d, v, c, hitOpts{drain: 20, stun: .25}))
	case "orbs":
		total := 0
		for i := 0; i < 3; i++ {
			v, _ := b.roll(a, rank, 5, 7, false)
			h := b.hit(a, d, v, false, hitOpts{})
			total += h.Amount
			add(h)
		}
		if total > 0 {
			ev.Heals = append(ev.Heals, b.heal(a, max(1, total/2)))
		}
	case "storm":
		a.Status.Charging = true
	case "thunderfall":
		a.Status.Charging = false
		v, _ := b.roll(a, rank, 40, 48, false)
		parts := []float64{.16, .16, .16, .16}
		used := 0
		for _, p := range parts {
			n := max(1, int(math.Round(float64(v)*p)))
			used += n
			add(b.hit(a, d, n, false, hitOpts{}))
		}
		add(b.hit(a, d, max(1, v-used), false, hitOpts{drain: 10}))
	case "mend":
		ev.Heals = append(ev.Heals, b.heal(a, int(math.Round(22*a.Power))))
	}
	if t.Gain > 0 {
		a.Energy = min(100, a.Energy+t.Gain)
	}
	b.evade = false
	b.push(ev)
}

// ---- enemy AI ----

func (b *Battle) aiChoose() string {
	e, p := &b.S.E, &b.S.P
	hpR := float64(e.HP) / float64(e.MaxHP)
	type opt struct {
		id string
		w  float64
	}
	var opts []opt
	add := func(id string, w float64) {
		if w <= 0 {
			return
		}
		if _, ok := rankOf(e, id); !ok || !CanUse(e, id) {
			return
		}
		opts = append(opts, opt{id, w})
	}
	pick := func(guarded, open float64) float64 {
		if p.Status.Guard {
			return guarded
		}
		return open
	}
	if hpR < .4 {
		add("mend", 4)
	}
	if p.HP <= 13 {
		add("staff", 6)
		add("strike", 6)
	}
	add("bolt", pick(.6, 3+boolf(p.Energy >= 60)*1.5))
	add("orbs", pick(.8, 2+boolf(hpR < .6)))
	add("storm", pick(4, boolf(b.S.Turn > 1)*2.2))
	add("staff", pick(.3, 1.8))
	add("strike", pick(.4, 2))
	add("shuriken", pick(2.5, 1.4))
	add("windblade", pick(4, 1.2))
	add("smoke", .4+boolf(p.Energy >= 35)*1.3)
	add("barrier", .5+boolf(p.Energy >= 35)*.9+boolf(hpR < .5)*.6)
	add("guard", .4+boolf(p.Energy >= 35)*.9+boolf(hpR < .5)*.6)
	total := 0.0
	for _, o := range opts {
		total += o.w
	}
	if total == 0 {
		if _, ok := rankOf(e, "staff"); ok {
			return "staff"
		}
		return e.Moves[0].ID
	}
	r := b.rng.Float64() * total
	for _, o := range opts {
		if r -= o.w; r <= 0 {
			return o.id
		}
	}
	return opts[len(opts)-1].id
}

func boolf(v bool) float64 {
	if v {
		return 1
	}
	return 0
}
