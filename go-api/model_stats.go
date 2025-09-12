package main

// Explicit table name for GORM scans in api_model_stats.
func (UserModelStat) TableName() string { return "user_model_stats" }
