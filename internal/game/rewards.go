package game

// Reward is what a finished battle pays out.
type Reward struct {
	Won        bool `json:"won"`
	Ryo        int  `json:"ryo"`
	XP         int  `json:"xp"`
	FirstClear bool `json:"firstClear"`
	Bonus      int  `json:"bonus"`
	LevelFrom  int  `json:"levelFrom"`
	LevelTo    int  `json:"levelTo"`
}

// RewardFor computes the payout for a mission result. Losses still give a
// quarter of the experience so a stuck player keeps progressing.
func RewardFor(m Mission, won, firstClear bool, totalXPBefore int) Reward {
	r := Reward{Won: won}
	if won {
		r.Ryo = m.Ryo
		r.XP = m.XP
		if firstClear {
			r.FirstClear = true
			r.Bonus = m.FirstBonus
			r.Ryo += m.FirstBonus
		}
	} else {
		r.XP = m.XP / 4
	}
	r.LevelFrom, _, _ = LevelFromXP(totalXPBefore)
	r.LevelTo, _, _ = LevelFromXP(totalXPBefore + r.XP)
	return r
}
