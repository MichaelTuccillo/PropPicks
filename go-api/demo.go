package main

import (
	"errors"
	"os"
	"strconv"
	"strings"
	"time"

	"gorm.io/gorm"
)

func isDemoEnabled() bool {
	return strings.ToLower(os.Getenv("DEMO_MODE")) == "true"
}

func demoSourceUserID() (string, error) {
	id := strings.TrimSpace(os.Getenv("DEMO_SOURCE_USER_ID"))
	if id == "" {
		return "", errors.New("DEMO_SOURCE_USER_ID not set")
	}
	return id, nil
}

func demoCloneLimit() int {
	if v := strings.TrimSpace(os.Getenv("DEMO_CLONE_LIMIT")); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			return n
		}
	}
	return 250
}

// cloneRealDataToDemo copies recent PastBetRecord rows from a source user into the new demo user,
// then recomputes UserModelStat so the charts match exactly.
func cloneRealDataToDemo(dstUserID string, tx *gorm.DB) error {
	srcID, err := demoSourceUserID()
	if err != nil {
		return err
	}
	limit := demoCloneLimit()

	// 1) Copy recent bets
	var srcBets []PastBetRecord
	if err := tx.
		Where("user_key = ?", srcID).
		Order("date DESC").
		Limit(limit).
		Find(&srcBets).Error; err != nil {
		return err
	}

	if len(srcBets) > 0 {
		clones := make([]PastBetRecord, 0, len(srcBets))
		for _, b := range srcBets {
			nb := b
			nb.ID = newID()
			nb.UserKey = dstUserID
			// Optional: nudge very old dates forward a bit so the demo feels fresh.
			// if time.Since(nb.Date) > 180*24*time.Hour { nb.Date = time.Now().AddDate(0, 0, -7) }
			clones = append(clones, nb)
		}
		if err := tx.Create(&clones).Error; err != nil {
			return err
		}
	}

	// 2) Recompute stats from the cloned bets (delete existing stats for this user first)
	if err := tx.Where("user_key = ?", dstUserID).Delete(&UserModelStat{}).Error; err != nil {
		return err
	}
	return recomputeStatsForUser(dstUserID, tx)
}

// recomputeStatsForUser scans PastBetRecord for a user and writes aggregate UserModelStat rows.
func recomputeStatsForUser(userID string, tx *gorm.DB) error {
	var bets []PastBetRecord
	if err := tx.Where("user_key = ?", userID).Find(&bets).Error; err != nil {
		return err
	}

	type key struct{ Model, Sport, Mode string }
	type agg struct {
		Wins, Losses, Pushes, Bets int
		Units                      float64
	}
	m := map[key]*agg{}

	for _, b := range bets {
		k := key{Model: b.Model, Sport: b.Sport, Mode: b.Type}
		a := m[k]
		if a == nil {
			a = &agg{}
			m[k] = a
		}
		a.Bets++
		if b.Result != nil {
			switch strings.ToLower(*b.Result) {
			case "win":
				a.Wins++
			case "loss":
				a.Losses++
			default:
				a.Pushes++
			}
		}
		if b.ResultUnits != nil {
			a.Units += *b.ResultUnits
		}
	}

	var rows []UserModelStat
	for k, a := range m {
		var roi float64
		if a.Bets > 0 {
			roi = (a.Units / float64(a.Bets)) * 100.0
		}
		rows = append(rows, UserModelStat{
			UserKey: userID,
			Model:   k.Model,
			Sport:   k.Sport,
			Mode:    k.Mode,
			Wins:    a.Wins,
			Losses:  a.Losses,
			Pushes:  a.Pushes,
			Bets:    a.Bets,
			Units:   a.Units,
			RoiPct:  roi,
			// if you track timestamps:
			UpdatedAt: time.Now().UTC(),
		})
	}
	if len(rows) == 0 {
		return nil
	}
	return tx.Create(&rows).Error
}
