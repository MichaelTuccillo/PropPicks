package main

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

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
		SameSite: http.SameSiteLaxMode,
		Secure:   cookieSecure,
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
		SameSite: http.SameSiteLaxMode,
		Secure:   cookieSecure,
		Expires:  time.Unix(0, 0),
		MaxAge:   -1,
	}
	http.SetCookie(w, c)
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
