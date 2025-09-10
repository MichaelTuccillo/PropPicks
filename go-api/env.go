package main

import (
	"log"
	"os"

	"github.com/joho/godotenv"
)

func mustLoadEnv() {
	_ = godotenv.Load() // load .env if present (ok if missing in prod)
	// minimal checks
	required := []string{"DATABASE_URL", "JWT_SECRET", "COOKIE_NAME", "CORS_ORIGIN"}
	for _, k := range required {
		if os.Getenv(k) == "" {
			log.Fatalf("missing required env %s", k)
		}
	}
}

func getenvDefault(k, d string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return d
}
