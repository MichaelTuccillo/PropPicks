package main

import "time"

// User is the persisted auth user record.
// auth.go (handlers) convert this to a lightweight DTO for the client.
type User struct {
	ID           string    `gorm:"primaryKey"`           // app-generated (e.g., newID())
	Email        string    `gorm:"uniqueIndex;size:320"` // unique, case-insensitive checks should be done in code
	DisplayName  string    `gorm:"size:120"`
	PasswordHash string    `gorm:"size:255"`             // bcrypt/argon2 hash (never send to client)

	CreatedAt time.Time
	UpdatedAt time.Time
}

// TableName allows explicit control (optional; defaults to "users").
func (User) TableName() string { return "users" }
