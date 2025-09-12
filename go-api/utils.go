package main

import (
	"crypto/rand"
	"encoding/hex"
	"time"
)

// newID returns a 24-hex-character unique id.
// If crypto/rand fails, we fall back to a timestamp-based id.
func newID() string {
	var b [12]byte
	if _, err := rand.Read(b[:]); err == nil {
		return hex.EncodeToString(b[:])
	}
	return hex.EncodeToString([]byte(time.Now().UTC().Format("20060102T150405.000000000")))
}
