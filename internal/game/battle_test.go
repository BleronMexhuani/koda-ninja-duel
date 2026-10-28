package game

import (
	"math/rand/v2"
	"testing"
)

func fullLoadout() []MoveSlot {
	return []MoveSlot{{"strike", 1}, {"shuriken", 1}, {"fireball", 1}, {"guard", 1}, {"meditate", 1}, {"phoenix", 1}}
}

// playRandom plays a battle with a simple sensible policy and returns the final state.
func playRandom(t *testing.T, m Mission, level int, seed uint64) *State {
	t.Helper()
	rng := rand.New(rand.NewPCG(seed, seed*7+1))
	b, err := NewBattle(m, level, fullLoadout(), rng)
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 200 && b.S.Phase == "player"; i++ {
		var choice string
		for _, id := range []string{"phoenix", "fireball", "shuriken", "strike"} {
			if b.S.E.Status.Charging && id != "shuriken" {
				continue
			}
			if CanUse(&b.S.P, id) {
				choice = id
				break
			}
		}
		if choice == "" {
			choice = "guard"
		}
		b.Events = nil
		if err := b.PlayerMove(choice); err != nil {
			t.Fatalf("move %s: %v", choice, err)
		}
		if len(b.Events) == 0 {
			t.Fatal("a turn produced no events")
		}
		for _, f := range []Fighter{b.S.P, b.S.E} {
			if f.HP < 0 || f.HP > f.MaxHP || f.Energy < 0 || f.Energy > 100 {
				t.Fatalf("out of range: %+v", f)
			}
		}
	}
	if b.S.Phase != "over" {
		t.Fatalf("battle did not finish: %+v", b.S)
	}
	last := b.Events[len(b.Events)-1]
	if last.Kind != "end" || last.Winner != b.S.Winner {
		t.Fatalf("last event should be the end: %+v", last)
	}
	return b.S
}

func TestBattlesFinishAndAreWinnable(t *testing.T) {
	for _, m := range Missions {
		wins := 0
		for seed := uint64(1); seed <= 200; seed++ {
			if playRandom(t, m, max(m.ReqLevel, 1)+1, seed).Winner == "p" {
				wins++
			}
		}
		t.Logf("%-8s win rate with a simple policy: %d%%", m.ID, wins/2)
		if wins == 0 {
			t.Errorf("mission %s was never won in 200 tries", m.ID)
		}
	}
}

func TestRejectsInvalidMoves(t *testing.T) {
	m, _ := MissionByID("bandit")
	b, _ := NewBattle(m, 1, []MoveSlot{{"strike", 1}, {"phoenix", 1}}, rand.New(rand.NewPCG(1, 2)))
	if err := b.PlayerMove("fireball"); err != ErrUnknownMove {
		t.Fatalf("expected ErrUnknownMove, got %v", err)
	}
	if err := b.PlayerMove("phoenix"); err != ErrCannotUse {
		t.Fatalf("expected ErrCannotUse, got %v", err)
	}
}

func TestShurikenBreaksStorm(t *testing.T) {
	m, _ := MissionByID("varga")
	b, _ := NewBattle(m, 3, fullLoadout(), rand.New(rand.NewPCG(3, 4)))
	b.S.E.Status.Charging = true
	b.S.P.Energy = 50
	b.Events = nil
	if err := b.PlayerMove("shuriken"); err != nil {
		t.Fatal(err)
	}
	broke := false
	for _, e := range b.Events {
		for _, h := range e.Hits {
			if h.Broke {
				broke = true
			}
		}
		if e.Move == "thunderfall" {
			t.Fatal("thunderfall should not land after the storm is broken")
		}
	}
	if !broke {
		t.Fatal("shuriken should break the storm")
	}
}

func TestGuardReducesDamage(t *testing.T) {
	m, _ := MissionByID("varga")
	b, _ := NewBattle(m, 3, fullLoadout(), rand.New(rand.NewPCG(5, 6)))
	a, d := &b.S.E, &b.S.P
	d.Status.Guard = true
	h := b.hit(a, d, 20, false, hitOpts{})
	if !h.Guarded || h.Amount != 6 {
		t.Fatalf("guard should cut 20 to 6, got %+v", h)
	}
	d.Status.Guard = true
	h = b.hit(a, d, 20, false, hitOpts{shieldBreak: true})
	if !h.ShieldBreak || h.Guarded || h.Amount != 20 {
		t.Fatalf("wind blade should shatter guard, got %+v", h)
	}
}

func TestLevels(t *testing.T) {
	cases := []struct{ xp, level int }{{0, 1}, {99, 1}, {100, 2}, {299, 2}, {300, 3}, {600, 4}}
	for _, c := range cases {
		if l, _, _ := LevelFromXP(c.xp); l != c.level {
			t.Errorf("xp %d: level %d, want %d", c.xp, l, c.level)
		}
	}
	m, _ := MissionByID("varga")
	r := RewardFor(m, true, true, 250)
	if r.Ryo != m.Ryo+m.FirstBonus || r.LevelFrom != 2 || r.LevelTo != 3 {
		t.Fatalf("unexpected reward %+v", r)
	}
}
