package main

import (
	"net/http"
)

// GET /api/model-stats
// Returns rows from user_model_stats for the current user (cookie/X-PP-User).
// Shape: { stats: [{model,sport,bets,wins,losses,pushes,units,roiPct}] }
func handleModelStats(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		errorJSON(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	userKey := userKeyFromRequest(r)
	if userKey == "" {
		errorJSON(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	if DB == nil {
		writeJSON(w, http.StatusOK, map[string]any{"stats": []any{}})
		return
	}

	type row struct {
		Model  string  `json:"model"`
		Sport  string  `json:"sport"`
		Bets   int     `json:"bets"`
		Wins   int     `json:"wins"`
		Losses int     `json:"losses"`
		Pushes int     `json:"pushes"`
		Units  float64 `json:"units"`
		RoiPct float64 `json:"roiPct"`
	}

	var out []row
	if err := DB.Table("user_model_stats").
		Select("model, sport, bets, wins, losses, pushes, units, roi_pct as roi_pct").
		Where("user_key = ?", userKey).
		Order("model asc, sport asc").
		Scan(&out).Error; err != nil {
		errorJSON(w, http.StatusInternalServerError, "db error")
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{"stats": out})
}
