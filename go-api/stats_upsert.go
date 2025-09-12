package main

import "gorm.io/gorm"

// Updates/creates the per-user, per-model, per-sport aggregate row when a bet’s result changes.
func upsertUserModelStat(
	db *gorm.DB,
	userKey, model, sport, prev, next string,
	prevUnits, nextUnits float64,
) error {
	var s UserModelStat
	err := db.Where(&UserModelStat{UserKey: userKey, Model: model, Sport: sport}).First(&s).Error
	if err == gorm.ErrRecordNotFound {
		s = UserModelStat{UserKey: userKey, Model: model, Sport: sport}
	} else if err != nil {
		return err
	}

	// Count a bet only when it transitions from ungraded -> graded
	if next != "" && prev == "" {
		s.Bets += 1
	}

	// Adjust W/L/P tallies based on transition
	if prev == "" && next == "" {
		// nothing
	} else if prev == "" && next != "" {
		switch next {
		case "win":
			s.Wins += 1
		case "loss":
			s.Losses += 1
		case "push":
			s.Pushes += 1
		}
	} else if prev != next {
		switch prev {
		case "win":
			s.Wins -= 1
		case "loss":
			s.Losses -= 1
		case "push":
			s.Pushes -= 1
		}
		switch next {
		case "win":
			s.Wins += 1
		case "loss":
			s.Losses += 1
		case "push":
			s.Pushes += 1
		}
	}

	// Units delta (new - old)
	s.Units += (nextUnits - prevUnits)
	if s.Bets > 0 {
		s.RoiPct = (s.Units / float64(s.Bets)) * 100.0
	} else {
		s.RoiPct = 0
	}

	return db.Save(&s).Error
}
