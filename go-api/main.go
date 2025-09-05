package main

import (
	"encoding/json"
	"log"
	"net/http"
	"os"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/cors"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

type User struct {
	ID        uint      `json:"id" gorm:"primaryKey"`
	Email     string    `json:"email" gorm:"uniqueIndex;not null"`
	CreatedAt time.Time `json:"created_at"`
}

func main() {
	// Read DSN from env or fall back to local dev DSN
	dsn := os.Getenv("DATABASE_DSN")
	if dsn == "" {
		dsn = "host=localhost user=postgres password= dbname=PropPicks port=5432 sslmode=disable TimeZone=UTC"
	}

	// Connect
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		log.Fatal("failed to connect database: ", err)
	}

	// Auto-migrate the schema (creates 'users' table if missing)
	if err := db.AutoMigrate(&User{}); err != nil {
		log.Fatal("auto-migrate failed: ", err)
	}

	// Router
	r := chi.NewRouter()
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   []string{"http://localhost:4200"},
		AllowedMethods:   []string{"GET", "POST", "OPTIONS"},
		AllowedHeaders:   []string{"*"},
		AllowCredentials: true,
	}))

	// Health
	r.Get("/api/hello", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"message":"Hello from Go!"}`))
	})

	// Create user
	r.Post("/api/users", func(w http.ResponseWriter, req *http.Request) {
		var body struct {
			Email string `json:"email"`
		}
		if err := json.NewDecoder(req.Body).Decode(&body); err != nil || body.Email == "" {
			http.Error(w, "email required", http.StatusBadRequest)
			return
		}
		u := User{Email: body.Email}
		if err := db.Create(&u).Error; err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(u)
	})

	// List users
	r.Get("/api/users", func(w http.ResponseWriter, req *http.Request) {
		var users []User
		if err := db.Order("id DESC").Limit(50).Find(&users).Error; err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(users)
	})

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}
	log.Printf("server listening on http://localhost:%s", port)
	log.Fatal(http.ListenAndServe(":"+port, r))
}
