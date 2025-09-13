package main

import (
	"net/http"
	"strings"
)

type statRow struct {
	Model   string  `json:"model"`
	Sport   string  `json:"sport"`
	Bets    int     `json:"bets"`
	Wins    int     `json:"wins"`
	Losses  int     `json:"losses"`
	Pushes  int     `json:"pushes"`
	Units   float64 `json:"units"`
	RoiPct  float64 `json:"roiPct"`
}

// GET /api/model-stats?mode=Single|SGP|SGP+|ALL
func handleModelStats(w http.ResponseWriter, r *http.Request) {
	userKey := userKeyFromRequest(r)
	if userKey == "" {
		errorJSON(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	if DB == nil {
		errorJSON(w, http.StatusInternalServerError, "db not initialized")
		return
	}

	mode := strings.TrimSpace(r.URL.Query().Get("mode"))
	switch strings.ToUpper(mode) {
	case "SINGLE":
		mode = "Single"
	case "SGP":
		mode = "SGP"
	case "SGP+":
		mode = "SGP+"
	default:
		mode = "ALL"
	}

	var rows []UserModelStat
	if err := DB.Where("user_key = ? AND mode = ?", userKey, mode).
		Find(&rows).Error; err != nil {
		errorJSON(w, http.StatusInternalServerError, "db error")
		return
	}

	out := make([]statRow, 0, len(rows))
	for _, s := range rows {
		out = append(out, statRow{
			Model:  s.Model,
			Sport:  s.Sport,
			Bets:   s.Bets,
			Wins:   s.Wins,
			Losses: s.Losses,
			Pushes: s.Pushes,
			Units:  s.Units,
			RoiPct: s.RoiPct,
		})
	}

	writeJSON(w, http.StatusOK, map[string]any{"stats": out})
}
