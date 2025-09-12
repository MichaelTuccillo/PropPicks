package main

import (
	"log"
	"net/http"
	"os"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/cors"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

var (
	DB          *gorm.DB
	jwtSecret   string
	cookieName  string
	cookieSecure bool
)

func main() {
	// Load env
	mustLoadEnv()

	// Connect DB
	var err error
	DB, err = gorm.Open(postgres.Open(os.Getenv("DATABASE_URL")), &gorm.Config{})
	if err != nil {
		log.Fatal("db connect:", err)
	}

	// Auto-migrate
	if err := DB.AutoMigrate(&User{}); err != nil {
		log.Fatal("migrate:", err)
	}

	jwtSecret = os.Getenv("JWT_SECRET")
	cookieName = os.Getenv("COOKIE_NAME")
	cookieSecure = os.Getenv("COOKIE_SECURE") == "true"

	r := chi.NewRouter()

	// CORS
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   []string{os.Getenv("CORS_ORIGIN")},
		AllowedMethods:   []string{"GET", "POST", "OPTIONS"},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type"},
		AllowCredentials: true,
		MaxAge:           300,
	}))

	// Health
	r.Get("/api/health", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	})

	// Auth routes
	r.Route("/api/auth", func(r chi.Router) {
		r.Post("/sign-up", SignUpHandler)
		r.Post("/sign-in", SignInHandler)
		r.Post("/sign-out", SignOutHandler)
		r.Get("/me", MeHandler)
	})

	r.Get("/api/games", handleListGames)


	addr := ":" + getenvDefault("PORT", "8080")
	srv := &http.Server{
		Addr:              addr,
		Handler:           r,
		ReadHeaderTimeout: 10 * time.Second,
	}

	r.Post("/api/generate-slip", handleGenerateSlip)

	log.Println("API listening on", addr)
	log.Fatal(srv.ListenAndServe())
}
