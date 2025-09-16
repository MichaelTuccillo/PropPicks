package main

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"
	"os"

	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"
)

/* ---------- DTOs ---------- */

type userDTO struct {
	ID          string `json:"id"`
	Email       string `json:"email"`
	DisplayName string `json:"displayName"`
}

/* ---------- Cookie helpers (relies on cookieName/cookieSecure from auth_support.go) ---------- */

func setAuthCookie(w http.ResponseWriter, token string) {
	c := &http.Cookie{
		Name:     cookieName,
		Value:    token,
		Path:     "/",
		HttpOnly: true,
		SameSite: cookieSameSite,
		Secure:   cookieSecure,
		Domain:   cookieDomain,
		// 30 days:
		Expires: time.Now().Add(30 * 24 * time.Hour),
		MaxAge:  int((30 * 24 * time.Hour).Seconds()),
	}
	http.SetCookie(w, c)
}

func clearAuthCookie(w http.ResponseWriter) {
	c := &http.Cookie{
		Name:     cookieName,
		Value:    "",
		Path:     "/",
		HttpOnly: true,
		SameSite: cookieSameSite,
		Secure:   cookieSecure,
		Domain:   cookieDomain,
		Expires:  time.Unix(0, 0),
		MaxAge:   -1,
	}
	http.SetCookie(w, c)
}

// --- DEMO MODE ---

// POST /api/auth/demo
// Creates a fresh throwaway user like a normal account and signs them in.
// Controlled by DEMO_MODE=true env (else 403).
func handleAuthDemoSignIn(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		errorJSON(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	if DB == nil {
		errorJSON(w, http.StatusInternalServerError, "db not initialized")
		return
	}
	if strings.ToLower(os.Getenv("DEMO_MODE")) != "true" {
		errorJSON(w, http.StatusForbidden, "demo mode disabled")
		return
	}

	// Create a unique throwaway email under a reserved domain that we treat as "demo".
	uid := newID()
	email := "demo-" + uid + "@demo.local"
	display := "Demo User"

	// Hash a dummy password (we won't ask for it, but keeps the row consistent).
	hash, _ := bcrypt.GenerateFromPassword([]byte("demo"), 10)

	u := User{
		ID:           uid,
		Email:        strings.ToLower(email),
		DisplayName:  display,
		PasswordHash: string(hash),
	}
	if err := DB.Create(&u).Error; err != nil {
		errorJSON(w, http.StatusInternalServerError, "db error")
		return
	}

	// Issue auth cookie (same as normal sign-in)
	tok, err := signToken(u.ID, 24*30) // 30 days
	if err != nil {
		errorJSON(w, http.StatusInternalServerError, "token error")
		return
	}
	setAuthCookie(w, tok)

	// Optionally seed some demo data so the account looks alive.
	if strings.ToLower(os.Getenv("DEMO_SEED_ON_LOGIN")) == "true" {
		if err := seedDemoData(u.ID); err != nil {
			// Seeding is best-effort; don't block login.
			// log.Println("[demo] seed error:", err)
		}
	}

	writeJSON(w, http.StatusOK, toDTO(u))
}

// POST /api/auth/demo-reset
// Clears this demo user's data and re-seeds it (only when DEMO_MODE=true and user is a demo user).
func handleAuthDemoReset(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		errorJSON(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	if strings.ToLower(os.Getenv("DEMO_MODE")) != "true" {
		errorJSON(w, http.StatusForbidden, "demo mode disabled")
		return
	}
	uid := userKeyFromRequest(r)
	if uid == "" {
		errorJSON(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	// Only allow for demo emails
	var u User
	if err := DB.First(&u, "id = ?", uid).Error; err != nil {
		errorJSON(w, http.StatusUnauthorized, "user not found")
		return
	}
	if !strings.HasSuffix(u.Email, "@demo.local") {
		errorJSON(w, http.StatusForbidden, "not a demo user")
		return
	}

	// Wipe this user's rows and reseed
	_ = DB.Where("user_key = ?", uid).Delete(&PastBetRecord{}).Error
	_ = DB.Where("user_key = ?", uid).Delete(&UserModelStat{}).Error
	if err := seedDemoData(uid); err != nil {
		errorJSON(w, http.StatusInternalServerError, "seed failed")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// Minimal, friendly demo seed with a few recent bets/stat rows.
// Adjust as you like; it only touches the current user's rows.
func seedDemoData(userID string) error {
	now := time.Now().UTC()

	// A small sample of bets over the past week
	makeBet := func(d int, sport, model, event, odds string, stake float64, result *string, ru *float64) PastBetRecord {
		return PastBetRecord{
			ID:          newID(),
			UserKey:     userID,
			Type:        "Single",
			Date:        now.AddDate(0, 0, -d),
			Model:       model,
			Sport:       sport,
			Event:       event,
			Odds:        odds,
			Stake:       stake,
			Result:      result,
			ResultUnits: ru,
		}
	}
	win := "win"
	loss := "loss"
	r1 := 1.2
	rm1 := -1.1

	bets := []PastBetRecord{
		makeBet(1, "NBA", "Model A", "LAL @ BOS - LeBron 25+ pts", "+150", 1, &win, &r1),
		makeBet(2, "NBA", "Model A", "GSW @ DEN - Jokic 10+ ast", "-110", 1, &loss, &rm1),
		makeBet(3, "NFL", "Model B", "Eagles ML", "+120", 1, &win, &r1),
		makeBet(5, "MLB", "Model A", "Yankees RL -1.5", "+140", 1, nil, nil), // pending
	}

	if err := DB.Create(&bets).Error; err != nil {
		return err
	}

	// Quick aggregate-ish stats (just example numbers)
	stats := []UserModelStat{
		{UserKey: userID, Model: "Model A", Sport: "NBA", Mode: "Single", Wins: 10, Losses: 6, Pushes: 1, Bets: 17, Units: 6.3, RoiPct: 12.5},
		{UserKey: userID, Model: "Model B", Sport: "NFL", Mode: "Single", Wins: 4, Losses: 3, Pushes: 0, Bets: 7, Units: 1.4, RoiPct: 5.2},
	}
	return DB.Create(&stats).Error
}


/* ---------- Utils ---------- */

func decodeJSON(r *http.Request, v any) error {
	defer r.Body.Close()
	return json.NewDecoder(r.Body).Decode(v)
}

func toDTO(u User) userDTO {
	return userDTO{ID: u.ID, Email: u.Email, DisplayName: u.DisplayName}
}

func findUserByEmail(db *gorm.DB, email string) (User, error) {
	var u User
	err := db.Where("LOWER(email) = ?", strings.ToLower(email)).First(&u).Error
	return u, err
}

func firstNonEmpty(ss ...string) string {
	for _, s := range ss {
		if strings.TrimSpace(s) != "" {
			return strings.TrimSpace(s)
		}
	}
	return ""
}

/* ---------- Handlers ---------- */

// POST /api/auth/register  { email, password, displayName? }  // also accepts display_name
func handleAuthRegister(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		errorJSON(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	if DB == nil {
		errorJSON(w, http.StatusInternalServerError, "db not initialized")
		return
	}

	var in struct {
		Email         string `json:"email"`
		Password      string `json:"password"`
		DisplayName   string `json:"displayName"`   // camelCase
		DisplayNameAlt string `json:"display_name"` // snake_case (fallback)
	}
	if err := decodeJSON(r, &in); err != nil {
		errorJSON(w, http.StatusBadRequest, "invalid JSON")
		return
	}
	in.Email = strings.TrimSpace(strings.ToLower(in.Email))
	if in.Email == "" || strings.TrimSpace(in.Password) == "" {
		errorJSON(w, http.StatusBadRequest, "email and password required")
		return
	}

	// derive a sane display name
	disp := firstNonEmpty(in.DisplayName, in.DisplayNameAlt)
	if disp == "" {
		if at := strings.IndexByte(in.Email, '@'); at > 0 {
			disp = in.Email[:at]
		} else {
			disp = in.Email
		}
	}

	// ensure unique email
	if _, err := findUserByEmail(DB, in.Email); err == nil {
		errorJSON(w, http.StatusConflict, "email already in use")
		return
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(in.Password), bcrypt.DefaultCost)
	if err != nil {
		errorJSON(w, http.StatusInternalServerError, "hash error")
		return
	}

	u := User{
		ID:           newID(),
		Email:        in.Email,
		DisplayName:  disp,
		PasswordHash: string(hash),
	}
	if err := DB.Create(&u).Error; err != nil {
		errorJSON(w, http.StatusInternalServerError, "db error")
		return
	}

	// issue cookie
	tok, err := signToken(u.ID, 24*30) // 30 days
	if err != nil {
		errorJSON(w, http.StatusInternalServerError, "token error")
		return
	}
	setAuthCookie(w, tok)
	writeJSON(w, http.StatusOK, toDTO(u))
}

// POST /api/auth/sign-in  { email, password }
func handleAuthSignIn(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		errorJSON(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	if DB == nil {
		errorJSON(w, http.StatusInternalServerError, "db not initialized")
		return
	}

	var in struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if err := decodeJSON(r, &in); err != nil {
		errorJSON(w, http.StatusBadRequest, "invalid JSON")
		return
	}
	in.Email = strings.TrimSpace(strings.ToLower(in.Email))
	if in.Email == "" || strings.TrimSpace(in.Password) == "" {
		errorJSON(w, http.StatusBadRequest, "email and password required")
		return
	}

	u, err := findUserByEmail(DB, in.Email)
	if err != nil {
		errorJSON(w, http.StatusUnauthorized, "invalid credentials")
		return
	}
	if err := bcrypt.CompareHashAndPassword([]byte(u.PasswordHash), []byte(in.Password)); err != nil {
		errorJSON(w, http.StatusUnauthorized, "invalid credentials")
		return
	}

	tok, err := signToken(u.ID, 24*30)
	if err != nil {
		errorJSON(w, http.StatusInternalServerError, "token error")
		return
	}
	setAuthCookie(w, tok)
	writeJSON(w, http.StatusOK, toDTO(u))
}

// GET /api/auth/me
func handleAuthMe(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		errorJSON(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	uid := userKeyFromRequest(r)
	if uid == "" || DB == nil {
		errorJSON(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	var u User
	if err := DB.First(&u, "id = ?", uid).Error; err != nil {
		errorJSON(w, http.StatusUnauthorized, "user not found")
		return
	}
	writeJSON(w, http.StatusOK, toDTO(u))
}

// POST /api/auth/sign-out
func handleAuthSignOut(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		errorJSON(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	clearAuthCookie(w)
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}
