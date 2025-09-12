package main

import (
	"log"

	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func openDB(dsn string) *gorm.DB {
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		log.Fatalf("open db: %v", err)
	}
	return db
}

// AutoMigrate all app tables.
// NOTE: PastBetRecord is defined in past_bets.go
//       User is your auth user model (already in your project)
func autoMigrate(db *gorm.DB) error {
	return db.AutoMigrate(
		&User{},
		&PastBetRecord{},
		&UserModelStat{},
	)
}
