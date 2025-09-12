package main

import (
	"log"
	"os"

	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

// Open a Postgres connection with GORM (no package-level DB here to avoid redeclare).
func openDB(dsn string) *gorm.DB {
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		log.Fatalf("open db: %v", err)
	}
	return db
}

// Auto-migrate all app models.
// NOTE: PastBetRecord and UserModelStat are defined in past_bets.go.
func autoMigrate(db *gorm.DB) error {
	return db.AutoMigrate(
		&User{},          // your existing auth user model
		&PastBetRecord{}, // per-bet storage
		&UserModelStat{}, // per-user, per-model, per-sport stats (and ALL)
	)
}

// Optional convenience: initialize from the DATABASE_URL env var.
// Returns (*gorm.DB or nil) so main.go can decide whether to use in-memory fallback.
func initDBFromEnv() *gorm.DB {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		log.Println("[db] DATABASE_URL not set; using in-memory fallback for bets/statistics")
		return nil
	}
	db := openDB(dsn)
	if err := autoMigrate(db); err != nil {
		log.Fatalf("auto-migrate failed: %v", err)
	}
	log.Println("[db] connected to Postgres via GORM")
	return db
}
