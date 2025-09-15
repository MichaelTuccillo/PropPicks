package main

import (
	"context"
	"database/sql"
	"log"
	"net"
	"os"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/stdlib"
)

func openDB() *sql.DB {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		log.Fatal("[DB] missing DATABASE_URL")
	}

	// Parse DSN and force IPv4 to avoid IPv6-only routes on some hosts
	cfg, err := pgx.ParseConfig(dsn)
	if err != nil {
		log.Fatalf("[DB] parse DSN: %v", err)
	}
	cfg.DialFunc = func(ctx context.Context, network, addr string) (net.Conn, error) {
		d := &net.Dialer{Timeout: 5 * time.Second, KeepAlive: 30 * time.Second}
		// Force IPv4
		return d.DialContext(ctx, "tcp4", addr)
	}

	db := stdlib.OpenDB(*cfg)

	// Reasonable pool settings for Render free/starter dynos
	db.SetMaxOpenConns(10)
	db.SetMaxIdleConns(10)
	db.SetConnMaxLifetime(30 * time.Minute)

	// Fast fail if unreachable
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	if err := db.PingContext(ctx); err != nil {
		log.Fatalf("[DB] connect failed: %v", err)
	}

	log.Println("[DB] connected")
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
