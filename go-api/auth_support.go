package main

import (
	"net/http"
	"os"
	"strings"
)

// cookie configuration (shared with auth.go)
var cookieName = getenv("COOKIE_NAME", "pp_auth")
var cookieSecure = os.Getenv("COOKIE_SECURE") == "true"

// optional cookie domain for subdomain setups (e.g., api.yourdomain.com + www.yourdomain.com)
var cookieDomain = os.Getenv("COOKIE_DOMAIN")

// let env control SameSite: "none" | "lax" | "strict"  (default: lax)
var cookieSameSite = func() http.SameSite {
	switch strings.ToLower(os.Getenv("COOKIE_SAMESITE")) {
	case "none":
		return http.SameSiteNoneMode
	case "strict":
		return http.SameSiteStrictMode
	default:
		return http.SameSiteLaxMode
	}
}()


// userKeyFromRequest extracts the authenticated user key from the JWT cookie,
// falling back to the X-PP-User header for development.
func userKeyFromRequest(r *http.Request) string {
	// 1) Cookie/JWT path
	if c, err := r.Cookie(cookieName); err == nil && c.Value != "" {
		if claims, err := parseToken(c.Value); err == nil && claims != nil && claims.UserID != "" {
			return claims.UserID
		}
	}
	// 2) Dev fallback header
	if v := strings.TrimSpace(r.Header.Get("X-PP-User")); v != "" {
		return v
	}
	return ""
}
