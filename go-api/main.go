package main

import (
	"errors"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/cors"
	"github.com/joho/godotenv"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

var DB *gorm.DB

func loadDotenv() {
	for _, p := range []string{".env", filepath.Join("..", ".env"), filepath.Join("..", "..", ".env")} {
		if _, err := os.Stat(p); err == nil {
			_ = godotenv.Overload(p)
			log.Println("[env] loaded", p)
			return
		}
	}
}

func envOr(k, d string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return d
}

func main() {
	loadDotenv()

	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		log.Fatal("[DB] DATABASE_URL is not set. Refusing to start.")
	}
	// local only: allow sslmode=disable if using localhost
	if strings.Contains(dsn, "localhost") && !strings.Contains(dsn, "sslmode=") {
		if strings.Contains(dsn, "?") {
			dsn += "&sslmode=disable"
		} else {
			dsn += "?sslmode=disable"
		}
	}

	// Quieter GORM logger
	gLogger := logger.New(
		log.New(os.Stdout, "", log.LstdFlags),
		logger.Config{
			SlowThreshold: 1500 * time.Millisecond,
			LogLevel:      logger.Warn,
			Colorful:      true,
		},
	)

	var err error
	DB, _, err = openGormIPv4(dsn, gLogger) // pgx simple protocol + IPv4 enforced
	if err != nil {
		log.Fatalf("[DB] connect failed: %v", err)
	}
	log.Println("[DB] connected")

	// ---- Router & middleware
	r := chi.NewRouter()

	corsOrigin := envOr("CORS_ORIGIN", "http://localhost:4200")
	// allow comma-separated list of origins
	var origins []string
	for _, p := range strings.Split(corsOrigin, ",") {
		if o := strings.TrimRight(strings.TrimSpace(p), "/"); o != "" {
			origins = append(origins, o)
		}
	}
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   origins,
		AllowedMethods:   []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type", "X-CSRF-Token", "X-Requested-With"},
		ExposedHeaders:   []string{"Set-Cookie"},
		AllowCredentials: true,
		MaxAge:           300,
	}))
	// Finish bare OPTIONS quickly
	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			if req.Method == http.MethodOptions {
				w.WriteHeader(http.StatusNoContent)
				return
			}
			next.ServeHTTP(w, req)
		})
	})

	// ---- Routes
	// Auth
	r.Post("/api/auth/register", handleAuthRegister)
	r.Post("/api/auth/sign-in", handleAuthSignIn)
	r.Post("/api/auth/sign-out", handleAuthSignOut)
	r.Get("/api/auth/me", handleAuthMe)

	// Bets & stats
	r.Get("/api/past-bets", handlePastBets)
	r.Post("/api/past-bets", handlePastBets)
	r.Post("/api/past-bets/result", handlePastBetResult)
	r.Get("/api/model-stats", handleModelStats)
	r.Get("/api/games", handleListGames)

	// OpenAI: generate slip
	r.Post("/api/generate-slip", handleGenerateSlip)

	// Health
	r.Get("/healthz", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{"ok": true})
	})

	addr := ":" + envOr("PORT", "8080")
	srv := &http.Server{
		Addr:              addr,
		Handler:           r,
		ReadHeaderTimeout: 10 * time.Second,
	}
	log.Println("API listening on", addr, "CORS_ORIGIN:", corsOrigin)
	log.Fatal(srv.ListenAndServe())
}
