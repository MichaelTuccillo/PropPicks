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
// and forces IPv4 both at DNS resolution time and at connect time.
// This avoids Render -> Supabase/Neon IPv6 egress issues.
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

	// 1) Prefer IPv4 when resolving the DB host.
	cfg.LookupFunc = func(ctx context.Context, host string) ([]string, error) {
		// Try A records (IPv4) first.
		ipAddrs, err := net.DefaultResolver.LookupIPAddr(ctx, host)
		if err == nil && len(ipAddrs) > 0 {
			v4 := make([]string, 0, len(ipAddrs))
			for _, ip := range ipAddrs {
				if ipv4 := ip.IP.To4(); ipv4 != nil {
					v4 = append(v4, ipv4.String())
				}
			}
			if len(v4) > 0 {
				return v4, nil
			}
		}
		// Fallback to default host lookup (may include IPv6 if no IPv4 available).
		return net.DefaultResolver.LookupHost(ctx, host)
	}

	// 2) Force an IPv4 socket for the actual TCP connection.
	cfg.DialFunc = func(ctx context.Context, _ string, addr string) (net.Conn, error) {
		d := &net.Dialer{Timeout: 5 * time.Second, KeepAlive: 30 * time.Second}
		return d.DialContext(ctx, "tcp4", addr) // e.g., "1.2.3.4:5432"
	}

	// Build *sql.DB from pgx config.
	sqlDB := stdlib.OpenDB(*cfg)

	// Reasonable pool settings for small Render instances.
	sqlDB.SetMaxOpenConns(10)
	sqlDB.SetMaxIdleConns(10)
	sqlDB.SetConnMaxLifetime(30 * time.Minute)

	// Fast fail if unreachable.
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
