package main

// add at top of auth.go
import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"
)


// --------- Helpers (cookie) ---------

func setAuthCookie(w http.ResponseWriter, token string) {
	c := &http.Cookie{
		Name:     cookieName,
		Value:    token,
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Secure:   cookieSecure,
		Expires:  time.Now().Add(30 * 24 * time.Hour),
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
		MaxAge:   -1,
	}
	http.SetCookie(w, c)
}

// --------- DTOs ---------

type authReq struct {
	Email       string `json:"email"`
	Password    string `json:"password"`
	DisplayName string `json:"displayName"` // optional
}

type userDTO struct {
	ID          string `json:"id"`
	Email       string `json:"email"`
	DisplayName string `json:"displayName"`
}

// --------- Handlers ---------

func SignUpHandler(w http.ResponseWriter, r *http.Request) {
	var in authReq
	if err := decodeJSON(r, &in); err != nil {
		errorJSON(w, http.StatusBadRequest, "invalid json")
		return
	}
	in.Email = strings.TrimSpace(strings.ToLower(in.Email))
	if in.Email == "" || in.Password == "" {
		errorJSON(w, http.StatusBadRequest, "email and password required")
		return
	}

	// Unique email?
	var count int64
	if err := DB.Model(&User{}).Where("email = ?", in.Email).Count(&count).Error; err != nil {
		errorJSON(w, http.StatusInternalServerError, "db error")
		return
	}
	if count > 0 {
		errorJSON(w, http.StatusConflict, "email already in use")
		return
	}

	hash, _ := bcrypt.GenerateFromPassword([]byte(in.Password), bcrypt.DefaultCost)
	u := User{
		Email:        in.Email,
		DisplayName:  strings.TrimSpace(in.DisplayName),
		PasswordHash: string(hash),
	}
	if err := DB.Create(&u).Error; err != nil {
		errorJSON(w, http.StatusInternalServerError, "db error")
		return
	}

	tok, err := signToken(u.ID, 24*30) // 30 days
	if err != nil {
		errorJSON(w, http.StatusInternalServerError, "token error")
		return
	}
	setAuthCookie(w, tok)
	writeJSON(w, http.StatusOK, toDTO(u))
}

func SignInHandler(w http.ResponseWriter, r *http.Request) {
	var in authReq
	if err := decodeJSON(r, &in); err != nil {
		errorJSON(w, http.StatusBadRequest, "invalid json")
		return
	}
	in.Email = strings.TrimSpace(strings.ToLower(in.Email))

	var u User
	err := DB.Where("email = ?", in.Email).First(&u).Error
	if err == gorm.ErrRecordNotFound {
		errorJSON(w, http.StatusUnauthorized, "invalid email or password")
		return
	} else if err != nil {
		errorJSON(w, http.StatusInternalServerError, "db error")
		return
	}

	if bcrypt.CompareHashAndPassword([]byte(u.PasswordHash), []byte(in.Password)) != nil {
		errorJSON(w, http.StatusUnauthorized, "invalid email or password")
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

func SignOutHandler(w http.ResponseWriter, r *http.Request) {
	clearAuthCookie(w)
	writeJSON(w, http.StatusOK, map[string]string{"status": "signed_out"})
}

func MeHandler(w http.ResponseWriter, r *http.Request) {
	c, err := r.Cookie(cookieName)
	if err != nil || c.Value == "" {
		errorJSON(w, http.StatusUnauthorized, "no session")
		return
	}
	claims, err := parseToken(c.Value)
	if err != nil {
		errorJSON(w, http.StatusUnauthorized, "invalid session")
		return
	}

	var u User
	if err := DB.First(&u, "id = ?", claims.UserID).Error; err != nil {
		errorJSON(w, http.StatusUnauthorized, "user not found")
		return
	}
	writeJSON(w, http.StatusOK, toDTO(u))
}

// --------- utils ---------

func decodeJSON(r *http.Request, v any) error {
	defer r.Body.Close()
	return jsonNewDecoder(r).Decode(v)
}

// minimal wrapper so we can keep imports tidy here
// (kept here to avoid adding another file just for a single line)
func jsonNewDecoder(r *http.Request) *jsonDecoder { return &jsonDecoder{r} }

type jsonDecoder struct{ r *http.Request }

func (d *jsonDecoder) Decode(v any) error {
	return json.NewDecoder(d.r.Body).Decode(v)
}

func toDTO(u User) userDTO {
	return userDTO{ID: u.ID, Email: u.Email, DisplayName: u.DisplayName}
}
