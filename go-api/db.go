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

// openGormIPv4 opens a *gorm.DB using pgx stdlib.
// - Forces IPv4 at DNS + dial (Render egress)
// - Uses SIMPLE protocol (no prepares)
// - Disables pgx statement cache (prevents "prepared statement already exists" with PgBouncer)
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

	// Prefer IPv4 when resolving
	cfg.LookupFunc = func(ctx context.Context, host string) ([]string, error) {
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
		return net.DefaultResolver.LookupHost(ctx, host)
	}

	// KEY: no prepared statements at all
	cfg.DefaultQueryExecMode = pgx.QueryExecModeSimpleProtocol
	cfg.StatementCacheCapacity = 0 // disable pgx stmt cache

	// Force IPv4 socket
	cfg.DialFunc = func(ctx context.Context, _ string, addr string) (net.Conn, error) {
		d := &net.Dialer{Timeout: 5 * time.Second, KeepAlive: 30 * time.Second}
		return d.DialContext(ctx, "tcp4", addr)
	}

	sqlDB := stdlib.OpenDB(*cfg)

	// Pool settings
	sqlDB.SetMaxOpenConns(10)
	sqlDB.SetMaxIdleConns(10)
	sqlDB.SetConnMaxLifetime(30 * time.Minute)

	// Fast fail
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	if err := sqlDB.PingContext(ctx); err != nil {
		return nil, sqlDB, err
	}

	if gl == nil {
		gl = logger.Default.LogMode(logger.Warn)
	}
	gdb, err := gorm.Open(postgres.New(postgres.Config{
		Conn: sqlDB,
	}), &gorm.Config{
		Logger:      gl,
		PrepareStmt: false, // be explicit: GORM should NOT use prepares
	})
	if err != nil {
		return nil, sqlDB, err
	}
	return gdb, sqlDB, nil
}

// Small sentinel error so callers get a clear message if DSN is missing.
var ErrMissingDSN = &dsnError{"missing DATABASE_URL or empty DSN"}

type dsnError struct{ s string }

func (e *dsnError) Error() string { return e.s }
