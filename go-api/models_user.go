package main

import "time"

// User is the persisted auth user record.
// auth.go (handlers) convert this to a lightweight DTO for the client.
type User struct {
	ID           string    `gorm:"primaryKey;type:text"` // <-- text PK, not bigint
	Email        string    `gorm:"uniqueIndex;size:320;not null"`
	DisplayName  string    `gorm:"size:120"`
	PasswordHash string    `gorm:"size:255;not null"`
	CreatedAt    time.Time
	UpdatedAt    time.Time
}

// TableName allows explicit control (optional; defaults to "users").
func (User) TableName() string { return "users" }
