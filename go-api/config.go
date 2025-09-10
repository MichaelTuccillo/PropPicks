package main

import "os"

type Config struct {
	DatabaseURL string
	JWTSecret   string
	CookieName  string
	CookieSecure bool
	CORSOrigin  string
	Port        string
}

func loadConfig() Config {
	secure := os.Getenv("COOKIE_SECURE") == "true"
	return Config{
		DatabaseURL: os.Getenv("DATABASE_URL"),
		JWTSecret:   os.Getenv("JWT_SECRET"),
		CookieName:  getenv("COOKIE_NAME", "pp_auth"),
		CookieSecure: secure,
		CORSOrigin:  getenv("CORS_ORIGIN", "http://localhost:4200"),
		Port:        getenv("PORT", "8080"),
	}
}

func getenv(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}
