package main

import (
	"gorm.io/gorm"
	"strings"
)

// Normalize mode to canonical values: "Single" | "SGP" | "SGP+" | "ALL"
func normMode(in string) string {
	switch strings.ToUpper(strings.TrimSpace(in)) {
	case "SINGLE":
		return "Single"
	case "SGP":
		return "SGP"
	case "SGP+":
		return "SGP+"
	default:
		return "ALL"
	}
}

// Update/create ONE aggregate row for (user, model, sport, mode).
func upsertOneMode(
	db *gorm.DB,
	userKey, model, sport, mode, prev, next string,
	prevUnits, nextUnits float64,
) error {
	var s UserModelStat
	err := db.Where(&UserModelStat{
		UserKey: userKey, Model: model, Sport: sport, Mode: mode,
	}).First(&s).Error
	if err == gorm.ErrRecordNotFound {
		s = UserModelStat{UserKey: userKey, Model: model, Sport: sport, Mode: mode}
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

// Public helper: update BOTH the per-mode row and the ALL row.
// mode should be "Single" | "SGP" | "SGP+" (we'll also write "ALL").
func upsertUserModelStat(
	db *gorm.DB,
	userKey, model, sport, mode, prev, next string,
	prevUnits, nextUnits float64,
) error {
	cMode := normMode(mode)
	// per-mode row
	if err := upsertOneMode(db, userKey, model, sport, cMode, prev, next, prevUnits, nextUnits); err != nil {
		return err
	}
	// ALL row (keeps your existing "ALL-time" aggregates working)
	return upsertOneMode(db, userKey, model, sport, "ALL", prev, next, prevUnits, nextUnits)
}
