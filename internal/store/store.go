// Package store is the PostgreSQL persistence layer.
package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/lib/pq"

	"github.com/BleronMexhuani/koda-ninja-duel/internal/game"
	"github.com/BleronMexhuani/koda-ninja-duel/migrations"
)

var (
	ErrNotFound      = errors.New("not found")
	ErrUsernameTaken = errors.New("that username is taken")
	ErrNoFunds       = errors.New("not enough ryo")
	ErrOwned         = errors.New("you already own that technique")
	ErrMaxRank       = errors.New("that technique is already at max rank")
)

// Store wraps the database handle.
type Store struct{ DB *sql.DB }

// Open connects and waits for the database to accept connections.
func Open(ctx context.Context, url string) (*Store, error) {
	db, err := sql.Open("postgres", url)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(20)
	db.SetMaxIdleConns(5)
	db.SetConnMaxLifetime(30 * time.Minute)
	var lastErr error
	for i := 0; i < 30; i++ {
		if lastErr = db.PingContext(ctx); lastErr == nil {
			return &Store{DB: db}, nil
		}
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(time.Second):
		}
	}
	return nil, fmt.Errorf("database not reachable: %w", lastErr)
}

// Migrate applies any embedded migration files that have not run yet.
func (s *Store) Migrate(ctx context.Context) error {
	if _, err := s.DB.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`); err != nil {
		return err
	}
	names, err := fs.Glob(migrations.FS, "*.sql")
	if err != nil {
		return err
	}
	sort.Strings(names)
	for _, name := range names {
		v, err := strconv.Atoi(strings.SplitN(name, "_", 2)[0])
		if err != nil {
			return fmt.Errorf("migration %s: name must start with a number", name)
		}
		var done bool
		if err := s.DB.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM schema_migrations WHERE version = $1)`, v).Scan(&done); err != nil {
			return err
		}
		if done {
			continue
		}
		body, err := migrations.FS.ReadFile(name)
		if err != nil {
			return err
		}
		err = s.tx(ctx, func(tx *sql.Tx) error {
			if _, err := tx.ExecContext(ctx, string(body)); err != nil {
				return fmt.Errorf("migration %s: %w", name, err)
			}
			_, err := tx.ExecContext(ctx, `INSERT INTO schema_migrations (version) VALUES ($1)`, v)
			return err
		})
		if err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) tx(ctx context.Context, fn func(*sql.Tx) error) error {
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	if err := fn(tx); err != nil {
		_ = tx.Rollback()
		return err
	}
	return tx.Commit()
}

// ---------- players & sessions ----------

// Player is a row from players plus derived level data.
type Player struct {
	ID       int64  `json:"-"`
	Username string `json:"username"`
	Ryo      int    `json:"ryo"`
	XP       int    `json:"xp"`
	Wins     int    `json:"wins"`
	Losses   int    `json:"losses"`
	Level    int    `json:"level"`
	XPInto   int    `json:"xpInto"`
	XPNeed   int    `json:"xpNeed"`
	MaxHP    int    `json:"maxHp"`
	hash     string
}

func (p *Player) derive() {
	p.Level, p.XPInto, p.XPNeed = game.LevelFromXP(p.XP)
	p.MaxHP = game.MaxHPForLevel(p.Level)
}

// PasswordHash exposes the stored hash for login checks.
func (p *Player) PasswordHash() string { return p.hash }

// CreatePlayer inserts a player with starting ryo and the starter techniques equipped.
func (s *Store) CreatePlayer(ctx context.Context, username, hash string) (*Player, error) {
	var id int64
	err := s.tx(ctx, func(tx *sql.Tx) error {
		err := tx.QueryRowContext(ctx, `INSERT INTO players (username, password_hash, ryo) VALUES ($1, $2, $3) RETURNING id`,
			username, hash, game.StartingRyo).Scan(&id)
		if pqErr, ok := err.(*pq.Error); ok && pqErr.Code == "23505" {
			return ErrUsernameTaken
		}
		if err != nil {
			return err
		}
		for slot, tid := range game.StarterLoadout {
			if _, err := tx.ExecContext(ctx, `INSERT INTO player_techniques (player_id, technique_id, slot) VALUES ($1, $2, $3)`, id, tid, slot); err != nil {
				return err
			}
		}
		_, err = tx.ExecContext(ctx, `INSERT INTO ledger (player_id, amount, reason) VALUES ($1, $2, 'starting purse')`, id, game.StartingRyo)
		return err
	})
	if err != nil {
		return nil, err
	}
	return s.PlayerByID(ctx, id)
}

const playerCols = `id, username, password_hash, ryo, xp, wins, losses`

func scanPlayer(row interface{ Scan(...any) error }) (*Player, error) {
	p := &Player{}
	if err := row.Scan(&p.ID, &p.Username, &p.hash, &p.Ryo, &p.XP, &p.Wins, &p.Losses); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	p.derive()
	return p, nil
}

func (s *Store) PlayerByID(ctx context.Context, id int64) (*Player, error) {
	return scanPlayer(s.DB.QueryRowContext(ctx, `SELECT `+playerCols+` FROM players WHERE id = $1`, id))
}

func (s *Store) PlayerByUsername(ctx context.Context, username string) (*Player, error) {
	return scanPlayer(s.DB.QueryRowContext(ctx, `SELECT `+playerCols+` FROM players WHERE lower(username) = lower($1)`, username))
}

func (s *Store) CreateSession(ctx context.Context, tokenHash []byte, playerID int64, ttl time.Duration) error {
	_, err := s.DB.ExecContext(ctx, `INSERT INTO sessions (token_hash, player_id, expires_at) VALUES ($1, $2, $3)`, tokenHash, playerID, time.Now().Add(ttl))
	return err
}

func (s *Store) PlayerBySession(ctx context.Context, tokenHash []byte) (*Player, error) {
	return scanPlayer(s.DB.QueryRowContext(ctx, `SELECT p.id, p.username, p.password_hash, p.ryo, p.xp, p.wins, p.losses
		FROM sessions s JOIN players p ON p.id = s.player_id WHERE s.token_hash = $1 AND s.expires_at > now()`, tokenHash))
}

func (s *Store) DeleteSession(ctx context.Context, tokenHash []byte) error {
	_, err := s.DB.ExecContext(ctx, `DELETE FROM sessions WHERE token_hash = $1`, tokenHash)
	return err
}

// PurgeSessions removes expired sessions.
func (s *Store) PurgeSessions(ctx context.Context) error {
	_, err := s.DB.ExecContext(ctx, `DELETE FROM sessions WHERE expires_at <= now()`)
	return err
}

// ---------- techniques ----------

// Owned is a technique a player has.
type Owned struct {
	ID   string
	Rank int
	Slot *int
}

func (s *Store) Techniques(ctx context.Context, playerID int64) (map[string]Owned, error) {
	rows, err := s.DB.QueryContext(ctx, `SELECT technique_id, rank, slot FROM player_techniques WHERE player_id = $1`, playerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]Owned{}
	for rows.Next() {
		var o Owned
		var slot sql.NullInt64
		if err := rows.Scan(&o.ID, &o.Rank, &slot); err != nil {
			return nil, err
		}
		if slot.Valid {
			v := int(slot.Int64)
			o.Slot = &v
		}
		out[o.ID] = o
	}
	return out, rows.Err()
}

// Loadout returns equipped techniques ordered by slot.
func (s *Store) Loadout(ctx context.Context, playerID int64) ([]game.MoveSlot, error) {
	rows, err := s.DB.QueryContext(ctx, `SELECT technique_id, rank FROM player_techniques WHERE player_id = $1 AND slot IS NOT NULL ORDER BY slot`, playerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []game.MoveSlot
	for rows.Next() {
		var m game.MoveSlot
		if err := rows.Scan(&m.ID, &m.Rank); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

func spend(ctx context.Context, tx *sql.Tx, playerID int64, amount int, reason, ref string) error {
	res, err := tx.ExecContext(ctx, `UPDATE players SET ryo = ryo - $1 WHERE id = $2 AND ryo >= $1`, amount, playerID)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNoFunds
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO ledger (player_id, amount, reason, ref) VALUES ($1, $2, $3, $4)`, playerID, -amount, reason, ref)
	return err
}

// Buy purchases a technique and equips it in the first free slot, if any.
func (s *Store) Buy(ctx context.Context, playerID int64, t game.Technique) error {
	return s.tx(ctx, func(tx *sql.Tx) error {
		if _, err := tx.ExecContext(ctx, `SELECT id FROM players WHERE id = $1 FOR UPDATE`, playerID); err != nil {
			return err
		}
		var exists bool
		if err := tx.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM player_techniques WHERE player_id = $1 AND technique_id = $2)`, playerID, t.ID).Scan(&exists); err != nil {
			return err
		}
		if exists {
			return ErrOwned
		}
		if err := spend(ctx, tx, playerID, t.Price, "buy technique", t.ID); err != nil {
			return err
		}
		var free sql.NullInt64
		if err := tx.QueryRowContext(ctx, `SELECT s FROM generate_series(0, $2::int - 1) s
			WHERE s NOT IN (SELECT slot FROM player_techniques WHERE player_id = $1 AND slot IS NOT NULL) ORDER BY s LIMIT 1`, playerID, game.MaxSlots).Scan(&free); err != nil && !errors.Is(err, sql.ErrNoRows) {
			return err
		}
		_, err := tx.ExecContext(ctx, `INSERT INTO player_techniques (player_id, technique_id, slot) VALUES ($1, $2, $3)`, playerID, t.ID, free)
		return err
	})
}

// Upgrade raises a technique's rank by one and returns the new rank.
func (s *Store) Upgrade(ctx context.Context, playerID int64, t game.Technique) (int, error) {
	var rank int
	err := s.tx(ctx, func(tx *sql.Tx) error {
		err := tx.QueryRowContext(ctx, `SELECT rank FROM player_techniques WHERE player_id = $1 AND technique_id = $2 FOR UPDATE`, playerID, t.ID).Scan(&rank)
		if errors.Is(err, sql.ErrNoRows) {
			return ErrNotFound
		}
		if err != nil {
			return err
		}
		if rank >= game.MaxRank {
			return ErrMaxRank
		}
		if err := spend(ctx, tx, playerID, game.UpgradeCost(t, rank), "upgrade technique", t.ID); err != nil {
			return err
		}
		rank++
		_, err = tx.ExecContext(ctx, `UPDATE player_techniques SET rank = $3 WHERE player_id = $1 AND technique_id = $2`, playerID, t.ID, rank)
		return err
	})
	return rank, err
}

// SetLoadout replaces the equipped techniques. ids must be owned and unique.
func (s *Store) SetLoadout(ctx context.Context, playerID int64, ids []string) error {
	return s.tx(ctx, func(tx *sql.Tx) error {
		if _, err := tx.ExecContext(ctx, `UPDATE player_techniques SET slot = NULL WHERE player_id = $1`, playerID); err != nil {
			return err
		}
		for i, id := range ids {
			res, err := tx.ExecContext(ctx, `UPDATE player_techniques SET slot = $3 WHERE player_id = $1 AND technique_id = $2`, playerID, id, i)
			if err != nil {
				return err
			}
			if n, _ := res.RowsAffected(); n == 0 {
				return fmt.Errorf("you don't own %q", id)
			}
		}
		return nil
	})
}

// ---------- missions ----------

// Progress is a player's record on one mission.
type Progress struct {
	Clears    int  `json:"clears"`
	BestTurns *int `json:"bestTurns"`
}

func (s *Store) Progress(ctx context.Context, playerID int64) (map[string]Progress, error) {
	rows, err := s.DB.QueryContext(ctx, `SELECT mission_id, clears, best_turns FROM mission_progress WHERE player_id = $1`, playerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]Progress{}
	for rows.Next() {
		var id string
		var p Progress
		var best sql.NullInt64
		if err := rows.Scan(&id, &p.Clears, &best); err != nil {
			return nil, err
		}
		if best.Valid {
			v := int(best.Int64)
			p.BestTurns = &v
		}
		out[id] = p
	}
	return out, rows.Err()
}

// ---------- battles ----------

// BattleRow is a stored battle.
type BattleRow struct {
	ID        string
	PlayerID  int64
	MissionID string
	Status    string
	State     game.State
}

// StartBattle forfeits any running battle and stores a new one.
func (s *Store) StartBattle(ctx context.Context, playerID int64, st *game.State) (string, error) {
	var id string
	err := s.tx(ctx, func(tx *sql.Tx) error {
		res, err := tx.ExecContext(ctx, `UPDATE battles SET status = 'forfeit', updated_at = now() WHERE player_id = $1 AND status = 'active'`, playerID)
		if err != nil {
			return err
		}
		if n, _ := res.RowsAffected(); n > 0 {
			if _, err := tx.ExecContext(ctx, `UPDATE players SET losses = losses + 1 WHERE id = $1`, playerID); err != nil {
				return err
			}
		}
		body, _ := json.Marshal(st)
		return tx.QueryRowContext(ctx, `INSERT INTO battles (player_id, mission_id, state, turns) VALUES ($1, $2, $3, $4) RETURNING id`,
			playerID, st.MissionID, body, st.Turn).Scan(&id)
	})
	return id, err
}

func (s *Store) ActiveBattle(ctx context.Context, playerID int64) (*BattleRow, error) {
	return scanBattle(s.DB.QueryRowContext(ctx, `SELECT id, player_id, mission_id, status, state FROM battles WHERE player_id = $1 AND status = 'active'`, playerID))
}

func scanBattle(row interface{ Scan(...any) error }) (*BattleRow, error) {
	b := &BattleRow{}
	var body []byte
	if err := row.Scan(&b.ID, &b.PlayerID, &b.MissionID, &b.Status, &body); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	if err := json.Unmarshal(body, &b.State); err != nil {
		return nil, err
	}
	return b, nil
}

// Settlement is applied when a battle finishes.
type Settlement struct {
	Won   bool
	Ryo   int
	XP    int
	Turns int
}

// WithBattle locks an active battle, lets fn advance it, and saves the result.
// If fn returns a settlement the battle is closed and rewards are paid in the
// same transaction. Pass firstClear back to fn so rewards can depend on it.
func (s *Store) WithBattle(ctx context.Context, playerID int64, battleID string,
	fn func(b *BattleRow, firstClear bool, xpBefore int) (*Settlement, error)) error {
	return s.tx(ctx, func(tx *sql.Tx) error {
		b, err := scanBattle(tx.QueryRowContext(ctx, `SELECT id, player_id, mission_id, status, state FROM battles
			WHERE id = $1 AND player_id = $2 AND status = 'active' FOR UPDATE`, battleID, playerID))
		if err != nil {
			return err
		}
		var xpBefore int
		if err := tx.QueryRowContext(ctx, `SELECT xp FROM players WHERE id = $1 FOR UPDATE`, playerID).Scan(&xpBefore); err != nil {
			return err
		}
		var clears int
		err = tx.QueryRowContext(ctx, `SELECT clears FROM mission_progress WHERE player_id = $1 AND mission_id = $2`, playerID, b.MissionID).Scan(&clears)
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return err
		}
		set, err := fn(b, clears == 0, xpBefore)
		if err != nil {
			return err
		}
		body, _ := json.Marshal(b.State)
		status := "active"
		if set != nil {
			status = "lost"
			if set.Won {
				status = "won"
			}
		}
		if _, err := tx.ExecContext(ctx, `UPDATE battles SET state = $2, status = $3, turns = $4, updated_at = now() WHERE id = $1`,
			b.ID, body, status, b.State.Turn); err != nil {
			return err
		}
		if set == nil {
			return nil
		}
		col := "losses"
		if set.Won {
			col = "wins"
		}
		if _, err := tx.ExecContext(ctx, `UPDATE players SET ryo = ryo + $2, xp = xp + $3, `+col+` = `+col+` + 1 WHERE id = $1`,
			playerID, set.Ryo, set.XP); err != nil {
			return err
		}
		if set.Ryo > 0 {
			if _, err := tx.ExecContext(ctx, `INSERT INTO ledger (player_id, amount, reason, ref) VALUES ($1, $2, 'mission reward', $3)`,
				playerID, set.Ryo, b.MissionID); err != nil {
				return err
			}
		}
		if set.Won {
			_, err = tx.ExecContext(ctx, `INSERT INTO mission_progress (player_id, mission_id, clears, best_turns, first_cleared_at)
				VALUES ($1, $2, 1, $3, now())
				ON CONFLICT (player_id, mission_id) DO UPDATE SET clears = mission_progress.clears + 1,
					best_turns = LEAST(mission_progress.best_turns, EXCLUDED.best_turns)`, playerID, b.MissionID, set.Turns)
		}
		return err
	})
}

// ---------- leaderboard ----------

type LeaderRow struct {
	Username string `json:"username"`
	Level    int    `json:"level"`
	XP       int    `json:"xp"`
	Wins     int    `json:"wins"`
	Clears   int    `json:"clears"`
}

func (s *Store) Leaderboard(ctx context.Context, limit int) ([]LeaderRow, error) {
	rows, err := s.DB.QueryContext(ctx, `SELECT p.username, p.xp, p.wins,
			(SELECT count(*) FROM mission_progress mp WHERE mp.player_id = p.id AND mp.clears > 0)
		FROM players p ORDER BY p.xp DESC, p.wins DESC, p.id LIMIT $1`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []LeaderRow
	for rows.Next() {
		var r LeaderRow
		if err := rows.Scan(&r.Username, &r.XP, &r.Wins, &r.Clears); err != nil {
			return nil, err
		}
		r.Level, _, _ = game.LevelFromXP(r.XP)
		out = append(out, r)
	}
	return out, rows.Err()
}
