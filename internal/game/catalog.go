// Package game holds the rules of Koda's world: techniques, enemies,
// missions, progression and the server-side battle engine.
package game

import "sort"

// Technique is a move a fighter can use in battle.
type Technique struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Short    string `json:"short"`
	Desc     string `json:"desc"`
	Style    string `json:"style"` // "ninja" or "monk": which rig can animate it
	Cost     int    `json:"cost"`
	Gain     int    `json:"gain"`
	Cooldown int    `json:"cooldown"`
	Attack   bool   `json:"attack"`
	Melee    bool   `json:"melee"`

	// Shop data. Only techniques with Shop=true can be owned by players.
	Shop       bool   `json:"shop"`
	Starter    bool   `json:"starter"`
	Price      int    `json:"price"`
	ReqLevel   int    `json:"reqLevel"`
	ReqMission string `json:"reqMission,omitempty"`
}

// MaxRank is the highest upgrade rank of a technique.
const MaxRank = 3

// UpgradeCost is the ryo needed to raise a technique from rank to rank+1.
func UpgradeCost(t Technique, rank int) int {
	base := t.Price
	if base == 0 {
		base = 150
	}
	return base * rank * 3 / 4
}

// RankMultiplier scales damage and healing with technique rank.
func RankMultiplier(rank int) float64 { return 1 + 0.15*float64(rank-1) }

var Techniques = map[string]Technique{
	// Koda's school (ninja rig)
	"strike": {ID: "strike", Name: "Strike", Short: "Two-hit combo, 10–13", Desc: "Dash in, punch and kick. Builds 10 energy. Punished by Guard and by a charging storm.",
		Style: "ninja", Gain: 10, Attack: true, Melee: true, Shop: true, Starter: true},
	"shuriken": {ID: "shuriken", Name: "Shuriken Volley", Short: "3 × 5–6, breaks storms", Desc: "Three stars. They slip past most of a guard and break a storm charge.",
		Style: "ninja", Cost: 15, Attack: true, Shop: true, Starter: true},
	"guard": {ID: "guard", Name: "Guard", Short: "−70% damage, +15", Desc: "Brace until your next turn. Blocks Burn and Stun, and counters melee for 4 per hit.",
		Style: "ninja", Gain: 15, Shop: true, Starter: true},
	"meditate": {ID: "meditate", Name: "Meditate", Short: "Heal 18, +25, cleanse", Desc: "Sit and breathe. Heals 18 and clears Burn. Two turns to recover after use.",
		Style: "ninja", Gain: 25, Cooldown: 2, Shop: true, Starter: true},
	"fireball": {ID: "fireball", Name: "Fireball", Short: "22–27 + Burn 2", Desc: "Gather fire in a hand seal and hurl it. Sets Burn for 2 turns unless blocked.",
		Style: "ninja", Cost: 35, Attack: true, Shop: true, Price: 250, ReqLevel: 1},
	"smoke": {ID: "smoke", Name: "Smoke Bomb", Short: "70% dodge next attack", Desc: "Vanish in smoke. The next attack against you this round has a 70% chance to miss completely.",
		Style: "ninja", Cost: 20, Shop: true, Price: 350, ReqLevel: 2},
	"windblade": {ID: "windblade", Name: "Wind Blade", Short: "16–20, shatters guard", Desc: "A crescent of cutting wind. Shatters Guard or Barrier and hits at full strength.",
		Style: "ninja", Cost: 25, Attack: true, Shop: true, Price: 500, ReqLevel: 2, ReqMission: "acolyte"},
	"phoenix": {ID: "phoenix", Name: "Phoenix Dive", Short: "42–50, pierces, Burn 3", Desc: "Leap into the sky and dive wreathed in fire. Ignores guard and burns for 3 turns.",
		Style: "ninja", Cost: 80, Attack: true, Shop: true, Price: 1200, ReqLevel: 4},
	"thunderpalm": {ID: "thunderpalm", Name: "Thunder Palm", Short: "28–34 melee, stun 30%", Desc: "Strike with a lightning-charged palm. Breaks storm charges and may stun.",
		Style: "ninja", Cost: 40, Attack: true, Melee: true, Shop: true, Price: 1800, ReqLevel: 5, ReqMission: "varga"},

	// Storm-monk school (monk rig, enemies only)
	"staff": {ID: "staff", Name: "Staff Strike", Short: "9–12 melee", Desc: "Glides in and cracks the staff down. Builds 10 energy.",
		Style: "monk", Gain: 10, Attack: true, Melee: true},
	"bolt": {ID: "bolt", Name: "Lightning Strike", Short: "18–24, −20 energy, may stun", Desc: "Calls a bolt down. Drains 20 energy and has a 25% chance to stun.",
		Style: "monk", Cost: 35, Attack: true},
	"orbs": {ID: "orbs", Name: "Void Orbs", Short: "3 × 5–7, heals half", Desc: "Three orbs curve in from different angles. Heals the caster for half the damage.",
		Style: "monk", Cost: 20, Attack: true},
	"barrier": {ID: "barrier", Name: "Barrier", Short: "−70% damage, +15", Desc: "Raises a ward until the caster's next turn.",
		Style: "monk", Gain: 15},
	"storm": {ID: "storm", Name: "Gather Storm", Short: "Next turn: Thunderfall", Desc: "Spends the turn charging. Next turn five bolts fall. Shuriken or Thunder Palm breaks it; other melee gets shocked.",
		Style: "monk", Cost: 30},
	"thunderfall": {ID: "thunderfall", Name: "Thunderfall", Short: "40–48 over five bolts", Desc: "The storm lands.", Style: "monk", Attack: true},
	"mend":        {ID: "mend", Name: "Dark Mend", Short: "Heal 22", Desc: "Draws the night into the caster's wounds.", Style: "monk", Cost: 25, Cooldown: 3},
}

// ShopTechniques returns the techniques players can own, cheapest first.
func ShopTechniques() []Technique {
	out := []Technique{}
	for _, t := range Techniques {
		if t.Shop {
			out = append(out, t)
		}
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Price != out[j].Price {
			return out[i].Price < out[j].Price
		}
		return out[i].ID < out[j].ID
	})
	return out
}

// Enemy describes an opponent and how the client should draw it.
type Enemy struct {
	ID      string   `json:"id"`
	Name    string   `json:"name"`
	Title   string   `json:"title"`
	Style   string   `json:"style"` // "ninja" or "monk"
	Palette string   `json:"palette"`
	MaxHP   int      `json:"maxHp"`
	Power   float64  `json:"power"`
	Moves   []string `json:"moves"`
	Energy  int      `json:"energy"`
}

var Enemies = map[string]Enemy{
	"bandit":   {ID: "bandit", Name: "Gorou", Title: "Road bandit", Style: "ninja", Palette: "bandit", MaxHP: 90, Power: .8, Moves: []string{"strike", "shuriken", "guard"}, Energy: 20},
	"acolyte":  {ID: "acolyte", Name: "Sen", Title: "Ash acolyte", Style: "monk", Palette: "acolyte", MaxHP: 110, Power: .85, Moves: []string{"staff", "orbs", "barrier"}, Energy: 25},
	"kunoichi": {ID: "kunoichi", Name: "Mirei", Title: "Reed-marsh kunoichi", Style: "ninja", Palette: "kunoichi", MaxHP: 125, Power: .95, Moves: []string{"strike", "shuriken", "smoke", "windblade", "guard"}, Energy: 30},
	"varga":    {ID: "varga", Name: "Varga", Title: "Storm-monk of the pass", Style: "monk", Palette: "varga", MaxHP: 160, Power: 1, Moves: []string{"staff", "bolt", "orbs", "barrier", "storm", "mend"}, Energy: 30},
	"ikaru":    {ID: "ikaru", Name: "Ikaru", Title: "The Thunder Sage", Style: "monk", Palette: "ikaru", MaxHP: 230, Power: 1.18, Moves: []string{"staff", "bolt", "orbs", "barrier", "storm", "mend"}, Energy: 40},
}

// Mission is a fight a player can take for ryo and experience.
type Mission struct {
	ID         string `json:"id"`
	Rank       string `json:"rank"`
	Name       string `json:"name"`
	Brief      string `json:"brief"`
	Enemy      string `json:"enemy"`
	Ryo        int    `json:"ryo"`
	XP         int    `json:"xp"`
	FirstBonus int    `json:"firstBonus"`
	ReqLevel   int    `json:"reqLevel"`
	ReqMission string `json:"reqMission,omitempty"`
}

// Missions in story order.
var Missions = []Mission{
	{ID: "bandit", Rank: "D", Name: "Trouble on the Old Road", Brief: "A bandit is robbing merchants at the river crossing. Chase him off.", Enemy: "bandit", Ryo: 120, XP: 60, FirstBonus: 100, ReqLevel: 1},
	{ID: "acolyte", Rank: "C", Name: "The Ash Acolyte", Brief: "An apprentice of the storm school guards the shrine stairs. He heals by draining you.", Enemy: "acolyte", Ryo: 170, XP: 90, FirstBonus: 150, ReqLevel: 1, ReqMission: "bandit"},
	{ID: "kunoichi", Rank: "C", Name: "Reeds at Dusk", Brief: "A rival kunoichi hides in smoke and cuts through guards with wind. Pressure her.", Enemy: "kunoichi", Ryo: 240, XP: 130, FirstBonus: 220, ReqLevel: 2, ReqMission: "acolyte"},
	{ID: "varga", Rank: "B", Name: "Storm over the Pass", Brief: "Varga holds the mountain pass. Break his storm before Thunderfall lands.", Enemy: "varga", Ryo: 420, XP: 220, FirstBonus: 400, ReqLevel: 3, ReqMission: "kunoichi"},
	{ID: "ikaru", Rank: "A", Name: "The Thunder Sage", Brief: "Varga's master waits at the summit. Every mistake is punished.", Enemy: "ikaru", Ryo: 750, XP: 400, FirstBonus: 800, ReqLevel: 5, ReqMission: "varga"},
}

// MissionByID looks a mission up.
func MissionByID(id string) (Mission, bool) {
	for _, m := range Missions {
		if m.ID == id {
			return m, true
		}
	}
	return Mission{}, false
}

// ---- progression ----

// StartingRyo is what a new account begins with.
const StartingRyo = 150

// StarterLoadout is what a new account owns, in slot order.
var StarterLoadout = []string{"strike", "shuriken", "guard", "meditate"}

// MaxSlots is the number of techniques a player can bring into battle.
const MaxSlots = 6

// XPToNext is the experience needed to go from level to level+1.
func XPToNext(level int) int { return 100 * level }

// LevelFromXP converts total experience into a level and the progress within it.
func LevelFromXP(total int) (level, into, need int) {
	level = 1
	for total >= XPToNext(level) {
		total -= XPToNext(level)
		level++
	}
	return level, total, XPToNext(level)
}

// MaxHPForLevel is Koda's health at a given level.
func MaxHPForLevel(level int) int { return 100 + 10*level }
