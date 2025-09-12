package main

import (
	"encoding/json"
	"net/http"
	"regexp"
	"strings"
	"sync"
	"time"

	"gorm.io/gorm"
)

/* ===================== Public JSON (API) ====================== */

type PastBet struct {
	ID          string  `json:"id"`
	Type        string  `json:"type"`  // Single | SGP | SGP+
	Date        string  `json:"date"`  // ISO 8601
	Model       string  `json:"model"`
	Sport       string  `json:"sport"`
	Event       string  `json:"event"`
	Odds        string  `json:"odds"` // e.g., "+450" or "-115"
	Result      string  `json:"result,omitempty"`      // "win" | "loss" | "push"
	ResultUnits float64 `json:"resultUnits,omitempty"` // +/- units for 1u stake
}

/* ===================== DB models ====================== */

type PastBetRecord struct {
	ID          string    `gorm:"primaryKey;type:text"`
	UserKey     string    `gorm:"index:idx_past_user_date_created,priority:1;type:text;not null"`
	Type        string    `gorm:"type:text;not null"` // Single | SGP | SGP+
	Date        time.Time `gorm:"index:idx_past_user_date_created,priority:2;type:timestamptz;not null"`
	Model       string    `gorm:"type:text;not null"`
	Sport       string    `gorm:"type:text;not null"`
	Event       string    `gorm:"type:text;not null"`
	Odds        string    `gorm:"type:text;not null"`
	Result      *string   `gorm:"type:text"`
	ResultUnits *float64
	CreatedAt   time.Time `gorm:"index:idx_past_user_date_created,priority:3;autoCreateTime"`
	UpdatedAt   time.Time `gorm:"autoUpdateTime"`
}

type UserModelStat struct {
	ID        uint      `gorm:"primaryKey"`
	UserKey   string    `gorm:"index:idx_user_model_sport,unique;type:text;not null"`
	Model     string    `gorm:"index:idx_user_model_sport,unique;type:text;not null"`
	Sport     string    `gorm:"index:idx_user_model_sport,unique;type:text;not null"` // NFL/NBA/NHL/MLB or "ALL"
	Wins      int       `gorm:"not null;default:0"`
	Losses    int       `gorm:"not null;default:0"`
	Pushes    int       `gorm:"not null;default:0"`
	Bets      int       `gorm:"not null;default:0"`
	Units     float64   `gorm:"not null;default:0"`
	RoiPct    float64   `gorm:"not null;default:0"`
	CreatedAt time.Time `gorm:"autoCreateTime"`
	UpdatedAt time.Time `gorm:"autoUpdateTime"`
}

/* ===================== In-memory fallback ====================== */

var (
	pastMu     sync.Mutex
	pastByUser = map[string][]PastBet{} // userKey -> bets (oldest..newest)
)

/* ===================== Helpers ====================== */

func toPublic(b PastBetRecord) PastBet {
	out := PastBet{
		ID:    b.ID,
		Type:  b.Type,
		Date:  b.Date.UTC().Format(time.RFC3339),
		Model: b.Model,
		Sport: b.Sport,
		Event: b.Event,
		Odds:  b.Odds,
	}
	if b.Result != nil {
		out.Result = *b.Result
	}
	if b.ResultUnits != nil {
		out.ResultUnits = *b.ResultUnits
	}
	return out
}

func mustParse(iso string) time.Time {
	t, err := time.Parse(time.RFC3339, iso)
	if err != nil {
		return time.Now().UTC()
	}
	return t
}

/* ===================== HTTP: list/create ====================== */

// GET/POST /api/past-bets
func handlePastBets(w http.ResponseWriter, r *http.Request) {
	userKey := userKeyFromRequest(r)
	if userKey == "" {
		errorJSON(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	switch r.Method {
	case http.MethodGet:
		if DB != nil {
			var recs []PastBetRecord
			if err := DB.Where("user_key = ?", userKey).
				Order("date DESC, created_at DESC").
				Limit(15).
				Find(&recs).Error; err != nil {
				errorJSON(w, http.StatusInternalServerError, "db error")
				return
			}
			out := make([]PastBet, 0, len(recs))
			for _, rc := range recs {
				out = append(out, toPublic(rc))
			}
			writeJSON(w, http.StatusOK, map[string]any{"bets": out})
			return
		}

		// in-memory fallback (reverse to newest-first)
		pastMu.Lock()
		list := append([]PastBet(nil), pastByUser[userKey]...)
		pastMu.Unlock()
		for i, j := 0, len(list)-1; i < j; i, j = i+1, j-1 {
			list[i], list[j] = list[j], list[i]
		}
		if len(list) > 15 {
			list = list[:15]
		}
		writeJSON(w, http.StatusOK, map[string]any{"bets": list})

	case http.MethodPost:
		var bet PastBet
		if err := json.NewDecoder(r.Body).Decode(&bet); err != nil {
			errorJSON(w, http.StatusBadRequest, "invalid JSON")
			return
		}
		if strings.TrimSpace(bet.Date) == "" {
			bet.Date = time.Now().UTC().Format(time.RFC3339)
		}
		id := newID()

		if DB != nil {
			rec := PastBetRecord{
				ID:      id,
				UserKey: userKey,
				Type:    bet.Type,
				Date:    mustParse(bet.Date),
				Model:   bet.Model,
				Sport:   bet.Sport,
				Event:   bet.Event,
				Odds:    bet.Odds,
			}
			if err := DB.Create(&rec).Error; err != nil {
				errorJSON(w, http.StatusInternalServerError, "db insert error")
				return
			}
			// keep newest 15 rows per user; delete older
			if err := trimPastBetsGorm(DB, userKey, 15); err != nil {
				errorJSON(w, http.StatusInternalServerError, "db trim error")
				return
			}
			writeJSON(w, http.StatusOK, map[string]any{"ok": true})
			return
		}

		// in-memory fallback (append; trim to 15)
		pastMu.Lock()
		defer pastMu.Unlock()
		row := bet
		row.ID = id
		pastByUser[userKey] = append(pastByUser[userKey], row)
		if len(pastByUser[userKey]) > 15 {
			pastByUser[userKey] = pastByUser[userKey][len(pastByUser[userKey])-15:]
		}
		writeJSON(w, http.StatusOK, map[string]any{"ok": true})

	default:
		errorJSON(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

/* ===================== HTTP: set result ====================== */

// POST /api/past-bets/result  { "id": "...", "result": "win"|"loss"|"push"|"" }
func handlePastBetResult(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		errorJSON(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	type payload struct {
		ID     string `json:"id"`
		Result string `json:"result"`
	}
	var p payload
	if err := json.NewDecoder(r.Body).Decode(&p); err != nil {
		errorJSON(w, http.StatusBadRequest, "invalid JSON")
		return
	}

	userKey := userKeyFromRequest(r)
	if userKey == "" {
		errorJSON(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	// Normalize/validate the result value; accept any casing
	res := strings.ToLower(strings.TrimSpace(p.Result))
	switch res {
	case "win", "loss", "push", "":
		// ok
	default:
		// Unknown token -> clear the result
		res = ""
	}

	if DB != nil {
		var rec PastBetRecord
		if err := DB.Where("id = ? AND user_key = ?", p.ID, userKey).First(&rec).Error; err != nil {
			if err == gorm.ErrRecordNotFound {
				errorJSON(w, http.StatusNotFound, "not found")
				return
			}
			errorJSON(w, http.StatusInternalServerError, "db error")
			return
		}

		// compute units delta vs previous
		prev := ""
		if rec.Result != nil {
			prev = *rec.Result
		}
		var prevUnits float64
		if rec.ResultUnits != nil {
			prevUnits = *rec.ResultUnits
		}
		newUnits := unitsForOutcome(rec.Odds, res, 1.0)

		// update record
		if res == "" {
			rec.Result = nil
			rec.ResultUnits = nil
		} else {
			rec.Result = &res
			rec.ResultUnits = &newUnits
		}
		if err := DB.Save(&rec).Error; err != nil {
			errorJSON(w, http.StatusInternalServerError, "db update error")
			return
		}

		// update aggregate stats
		if err := upsertUserModelStat(DB, userKey, rec.Model, rec.Sport, prev, res, prevUnits, newUnits); err != nil {
			errorJSON(w, http.StatusInternalServerError, "stats update error")
			return
		}

		// respond with the updated row
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "bet": toPublic(rec)})
		return
	}

	// in-memory fallback
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

/* ===================== DB helpers ====================== */

func trimPastBetsGorm(db *gorm.DB, userKey string, keep int) error {
	// Keep newest N by date/created_at; delete anything else
	var ids []string
	if err := db.Model(&PastBetRecord{}).
		Where("user_key = ?", userKey).
		Order("date DESC, created_at DESC").
		Limit(keep).
		Pluck("id", &ids).Error; err != nil {
		return err
	}
	if len(ids) == 0 {
		return nil
	}
	return db.Where("user_key = ? AND id NOT IN ?", userKey, ids).
		Delete(&PastBetRecord{}).Error
}

/* ===================== Odds helpers ====================== */

var moneyline = regexp.MustCompile(`^[-+]\d+$`)

func unitsForOutcome(odds string, outcome string, stake float64) float64 {
	outcome = strings.ToLower(strings.TrimSpace(outcome))
	switch outcome {
	case "loss":
		return -stake
	case "push":
		return 0
	case "win":
		// continue
	default:
		return 0
	}
	odds = strings.TrimSpace(odds)
	if !moneyline.MatchString(odds) {
		return 0
	}
	val := 0
	sign := 1
	if odds[0] == '-' {
		sign = -1
	}
	for _, ch := range odds[1:] {
		val = val*10 + int(ch-'0')
	}
	if sign > 0 {
		return float64(val) / 100.0 * stake
	}
	return 100.0 / float64(val) * stake
}
