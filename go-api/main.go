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
	DB *gorm.DB
)

func main() {
	// --- DB ---
	dsn := os.Getenv("DATABASE_URL")
	var err error
	if dsn != "" {
		DB, err = gorm.Open(postgres.Open(dsn), &gorm.Config{})
		if err != nil {
			log.Fatalf("failed to connect database: %v", err)
		}
		// Auto-migrate tables we use
		if err := DB.AutoMigrate(&PastBetRecord{}, &UserModelStat{}); err != nil {
			log.Fatalf("auto-migrate failed: %v", err)
		}
	}

	r := chi.NewRouter()

	// --- CORS (must be before any routes/middleware using cookies) ---
	corsOrigin := os.Getenv("CORS_ORIGIN")
	if corsOrigin == "" {
		// Safe default for local dev
		corsOrigin = "http://localhost:4200"
	}
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   []string{corsOrigin},
		AllowedMethods:   []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type", "X-CSRF-Token"},
		ExposedHeaders:   []string{"Set-Cookie"},
		AllowCredentials: true, // required since Angular uses { withCredentials: true }
		MaxAge:           300,  // seconds
	}))

	// --- (Optional) Short-circuit OPTIONS if you add strict auth later ---
	// r.Use(func(next http.Handler) http.Handler {
	// 	return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
	// 		if req.Method == http.MethodOptions {
	// 			w.WriteHeader(http.StatusNoContent)
	// 			return
	// 		}
	// 		next.ServeHTTP(w, req)
	// 	})
	// })

	// --- Auth / cookies middleware would go here ---
	// r.Use(AuthMiddleware)

	// --- API routes ---
	// Games & stats (existing)
	r.Get("/api/games", handleListGames)
	r.Get("/api/model-stats", handleModelStats)
	r.Post("/api/generate-slip", handleGenerateSlip)

	// Past bets (the ones failing CORS for you)
	r.Get("/api/past-bets", handlePastBets)
	r.Post("/api/past-bets", handlePastBets)
	r.Post("/api/past-bets/result", handlePastBetResult)

	addr := ":" + getenvDefault("PORT", "8080")
	srv := &http.Server{
		Addr:              addr,
		Handler:           r,
		ReadHeaderTimeout: 10 * time.Second,
	}
	log.Println("API listening on", addr)
	log.Fatal(srv.ListenAndServe())
}
