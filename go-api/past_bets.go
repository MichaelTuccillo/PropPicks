package main

import (
	"encoding/json"
	"math/rand"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"gorm.io/gorm"
)

/* ===================== Public JSON (API) ====================== */

type PastBet struct {
	ID          string  `json:"id"`
	Type        string  `json:"type"`  // Single | SGP | SGP+
	Date        string  `json:"date"`  // ISO
	Model       string  `json:"model"`
	Sport       string  `json:"sport"`
	Event       string  `json:"event"`
	Odds        string  `json:"odds"` // "+650" or "-115"
	Result      string  `json:"result,omitempty"`      // "win" | "loss" | "push"
	ResultUnits float64 `json:"resultUnits,omitempty"` // profit/loss in units for 1u stake
}

/* ===================== GORM models ====================== */

type PastBetRecord struct {
	ID          string    `gorm:"primaryKey;type:text"`
	UserKey     string    `gorm:"index;type:text;not null"`
	Type        string    `gorm:"type:text;not null"` // Single | SGP | SGP+
	Date        time.Time `gorm:"type:timestamptz;not null"`
	Model       string    `gorm:"type:text;not null"`
	Sport       string    `gorm:"type:text;not null"`
	Event       string    `gorm:"type:text;not null"`
	Odds        string    `gorm:"type:text;not null"`
	Result      *string   `gorm:"type:text"` // nullable
	ResultUnits *float64  // nullable
	CreatedAt   time.Time `gorm:"autoCreateTime"`
	UpdatedAt   time.Time `gorm:"autoUpdateTime"`
}

func (PastBetRecord) TableName() string { return "past_bets" }

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
	RoiPct    float64   `gorm:"not null;default:0"` // units/bets * 100 (1u stake assumption)
	CreatedAt time.Time `gorm:"autoCreateTime"`
	UpdatedAt time.Time `gorm:"autoUpdateTime"`
}

func (UserModelStat) TableName() string { return "user_model_stats" }

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

/* ===================== In-memory fallback ====================== */

var (
	pastMu     sync.Mutex
	pastByUser = map[string][]PastBet{} // userKey -> bets (oldest..newest)
)

/* ===================== HTTP: list/create ====================== */

// GET/POST /api/past-bets
func handlePastBets(w http.ResponseWriter, r *http.Request) {
	userKey := userKeyFromRequest(w, r)

	switch r.Method {
	case http.MethodGet:
		if DB != nil {
			var recs []PastBetRecord
			if err := DB.Where("user_key = ?", userKey).
				Order("date DESC, created_at DESC").
				Limit(100).
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

		// in-memory
		pastMu.Lock()
		list := append([]PastBet(nil), pastByUser[userKey]...)
		pastMu.Unlock()
		for i, j := 0, len(list)-1; i < j; i, j = i+1, j-1 {
			list[i], list[j] = list[j], list[i]
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
			// Keep newest 15 rows per user (but stats are ALL-TIME; we do not decrement)
			if err := trimPastBetsGorm(DB, userKey, 15); err != nil {
				// non-fatal
			}
			writeJSON(w, http.StatusOK, map[string]any{"ok": true})
			return
		}

		// in-memory
		bet.ID = id
		pastMu.Lock()
		list := pastByUser[userKey]
		list = append(list, bet)
		if len(list) > 15 {
			list = list[len(list)-15:]
		}
		pastByUser[userKey] = list
		pastMu.Unlock()

		writeJSON(w, http.StatusOK, map[string]any{"ok": true})

	default:
		errorJSON(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

/* ===================== HTTP: set result ====================== */

// POST /api/past-bets/result  { "id": "...", "outcome": "win"|"loss"|"push" }
func handlePastBetResult(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		errorJSON(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	userKey := userKeyFromRequest(w, r)

	var req struct {
		ID      string `json:"id"`
		Outcome string `json:"outcome"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || strings.TrimSpace(req.ID) == "" {
		errorJSON(w, http.StatusBadRequest, "invalid JSON")
		return
	}
	outcome := strings.ToLower(strings.TrimSpace(req.Outcome))

	if DB != nil {
		// fetch bet
		var rec PastBetRecord
		err := DB.Where("id = ? AND user_key = ?", req.ID, userKey).Take(&rec).Error
		if err == gorm.ErrRecordNotFound {
			errorJSON(w, http.StatusNotFound, "bet not found")
			return
		}
		if err != nil {
			errorJSON(w, http.StatusInternalServerError, "db fetch error")
			return
		}

		prevOutcome := rec.Result        // *string
		prevUnits := rec.ResultUnits     // *float64
		newUnits := unitsForOutcome(rec.Odds, outcome, 1.0)

		// update bet row
		rec.Result = ptr(outcome)
		rec.ResultUnits = ptr(newUnits)
		if err := DB.Save(&rec).Error; err != nil {
			errorJSON(w, http.StatusInternalServerError, "db update error")
			return
		}

		// update stats for (user,model,sport) and (user,model,ALL)
		if err := updateUserModelStat(DB, userKey, rec.Model, rec.Sport, prevOutcome, prevUnits, outcome, newUnits); err != nil {
			// non-fatal, but log
		}
		if err := updateUserModelStat(DB, userKey, rec.Model, "ALL", prevOutcome, prevUnits, outcome, newUnits); err != nil {
			// non-fatal
		}

		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "bet": toPublic(rec)})
		return
	}

	// in-memory fallback
	pastMu.Lock()
	defer pastMu.Unlock()
	list := pastByUser[userKey]
	idx := -1
	for i := range list {
		if list[i].ID == req.ID {
			idx = i
			break
		}
	}
	if idx == -1 {
		errorJSON(w, http.StatusNotFound, "bet not found")
		return
	}
	bet := list[idx]
	bet.Result = outcome
	bet.ResultUnits = unitsForOutcome(bet.Odds, outcome, 1.0)
	list[idx] = bet
	pastByUser[userKey] = list

	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "bet": bet})
}

/* ===================== GORM helpers ====================== */

func trimPastBetsGorm(db *gorm.DB, userKey string, keep int) error {
	// get newest N ids
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
	// delete anything else for that user
	return db.
		Where("user_key = ? AND id NOT IN ?", userKey, ids).
		Delete(&PastBetRecord{}).Error
}

// Update (or create) stats row by applying delta from prev->new outcome.
// ROI% = Units / Bets * 100 (1u stake per bet).
func updateUserModelStat(db *gorm.DB, userKey, model, sport string, prevOutcome *string, prevUnits *float64, newOutcome string, newUnits float64) error {
	var s UserModelStat
	err := db.Where("user_key = ? AND model = ? AND sport = ?", userKey, model, sport).Take(&s).Error
	if err == gorm.ErrRecordNotFound {
		s = UserModelStat{UserKey: userKey, Model: model, Sport: sport}
	}
	if err != nil && err != gorm.ErrRecordNotFound {
		return err
	}

	// deltas
	var prev string
	var pUnits float64
	if prevOutcome != nil {
		prev = strings.ToLower(strings.TrimSpace(*prevOutcome))
	}
	if prevUnits != nil {
		pUnits = *prevUnits
	}

	// adjust counts/bets
	if prev == "" {
		// first time setting a result for this bet
		s.Bets += 1
		switch newOutcome {
		case "win":
			s.Wins += 1
		case "loss":
			s.Losses += 1
		case "push":
			s.Pushes += 1
		}
	} else if prev != newOutcome {
		// move between buckets (bets count stays the same)
		switch prev {
		case "win":
			s.Wins -= 1
		case "loss":
			s.Losses -= 1
		case "push":
			s.Pushes -= 1
		}
		switch newOutcome {
		case "win":
			s.Wins += 1
		case "loss":
			s.Losses += 1
		case "push":
			s.Pushes += 1
		}
	}
	// units delta
	s.Units += (newUnits - pUnits)

	// recompute ROI%
	if s.Bets > 0 {
		s.RoiPct = (s.Units / float64(s.Bets)) * 100.0
	} else {
		s.RoiPct = 0
	}

	// upsert
	if s.ID == 0 {
		return db.Create(&s).Error
	}
	return db.Save(&s).Error
}

/* ===================== Shared utils ====================== */

func userKeyFromRequest(w http.ResponseWriter, r *http.Request) string {
	if hk := strings.TrimSpace(r.Header.Get("X-PP-User")); hk != "" {
		if len(hk) > 128 {
			hk = hk[:128]
		}
		return hk
	}
	return ensureUserCookie(w, r)
}

func ensureUserCookie(w http.ResponseWriter, r *http.Request) string {
	const name = "pp_uid"
	if c, err := r.Cookie(name); err == nil && c.Value != "" {
		return c.Value
	}
	rand.Seed(time.Now().UnixNano())
	id := newID()
	http.SetCookie(w, &http.Cookie{
		Name:     name,
		Value:    id,
		Path:     "/",
		SameSite: http.SameSiteLaxMode,
		HttpOnly: true,
	})
	return id
}

func newID() string {
	const letters = "abcdefghijklmnopqrstuvwxyz0123456789"
	b := make([]byte, 16)
	for i := range b {
		b[i] = letters[rand.Intn(len(letters))]
	}
	return string(b)
}

var reInt = regexp.MustCompile(`[+-]?\d+`)

func extractAmerican(s string) (int, bool) {
	m := reInt.FindString(s)
	if m == "" {
		return 0, false
	}
	sign := 1
	if m[0] == '+' {
		m = m[1:]
	} else if m[0] == '-' {
		sign = -1
		m = m[1:]
	}
	n, err := strconv.Atoi(m)
	if err != nil || n == 0 {
		return 0, false
	}
	return sign * n, true
}

// units for 1u stake
func unitsForOutcome(odds string, outcome string, stake float64) float64 {
	outcome = strings.ToLower(strings.TrimSpace(outcome))
	switch outcome {
	case "loss":
		return -stake
	case "push":
		return 0
	case "win":
	default:
		return 0
	}
	val, ok := extractAmerican(odds)
	if !ok || val == 0 {
		return 0
	}
	if val > 0 {
		return float64(val) / 100.0 * stake
	}
	return 100.0 / float64(-val) * stake
}

func mustParse(iso string) time.Time {
	t, err := time.Parse(time.RFC3339, iso)
	if err != nil {
		return time.Now().UTC()
	}
	return t
}

func ptr[T any](v T) *T { return &v }
