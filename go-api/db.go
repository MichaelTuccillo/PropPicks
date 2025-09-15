package main

import (
	"context"
	"database/sql"
	"net"
	"os"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/stdlib"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// openGormIPv4 opens a *gorm.DB using a pgx stdlib *sql.DB underneath,
// and forces IPv4 ("tcp4") so Render can reach Supabase/Neon even when AAAA resolves first.
func openGormIPv4(dsn string, gl logger.Interface) (*gorm.DB, *sql.DB, error) {
	if dsn == "" {
		dsn = os.Getenv("DATABASE_URL")
	}
	if dsn == "" {
		return nil, nil, ErrMissingDSN
	}

	cfg, err := pgx.ParseConfig(dsn)
	if err != nil {
		return nil, nil, err
	}
	// Force IPv4
	cfg.DialFunc = func(ctx context.Context, _ string, addr string) (net.Conn, error) {
		d := &net.Dialer{Timeout: 5 * time.Second, KeepAlive: 30 * time.Second}
		return d.DialContext(ctx, "tcp4", addr)
	}

	sqlDB := stdlib.OpenDB(*cfg)

	// Pooling sensible for Render starter
	sqlDB.SetMaxOpenConns(10)
	sqlDB.SetMaxIdleConns(10)
	sqlDB.SetConnMaxLifetime(30 * time.Minute)

	// Fast fail if unreachable
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	if err := sqlDB.PingContext(ctx); err != nil {
		return nil, sqlDB, err
	}

	if gl == nil {
		gl = logger.Default.LogMode(logger.Warn)
	}
	gdb, err := gorm.Open(postgres.New(postgres.Config{Conn: sqlDB}), &gorm.Config{Logger: gl})
	if err != nil {
		return nil, sqlDB, err
	}
	return gdb, sqlDB, nil
}

// Small sentinel error so callers get a clear message if DSN is missing.
var ErrMissingDSN = &dsnError{"missing DATABASE_URL or empty DSN"}

type dsnError struct{ s string }
func (e *dsnError) Error() string { return e.s }
