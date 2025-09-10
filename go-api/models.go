package main

import "time"

type User struct {
	ID           string    `gorm:"type:uuid;default:gen_random_uuid();primaryKey"`
	Email        string    `gorm:"uniqueIndex;not null"`
	DisplayName  string    `gorm:"type:varchar(64)"`
	PasswordHash string    `gorm:"type:varchar(72);not null"`
	CreatedAt    time.Time
	UpdatedAt    time.Time
}
