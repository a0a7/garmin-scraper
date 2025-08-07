-- Database schema for Garmin activities
-- Run this in your D1 database to create the required tables

-- Main activities table
CREATE TABLE IF NOT EXISTS activities (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    start_time TEXT NOT NULL,
    duration INTEGER,
    moving_time INTEGER,
    calories INTEGER,
    average_hr INTEGER,
    max_hr INTEGER,
    distance REAL,
    average_speed REAL,
    max_speed REAL,
    elevation_gain REAL,
    elevation_loss REAL,
    average_power REAL,
    max_power REAL,
    normalized_power REAL,
    training_stress_score REAL,
    average_cadence REAL,
    max_cadence REAL,
    total_reps INTEGER,
    total_sets INTEGER,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- Exercise sets table for strength training activities
CREATE TABLE IF NOT EXISTS exercise_sets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    activity_id TEXT NOT NULL,
    exercise_name TEXT NOT NULL,
    category TEXT,
    set_number INTEGER NOT NULL,
    reps INTEGER,
    weight REAL,
    duration INTEGER,
    rest_time INTEGER,
    total_volume REAL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (activity_id) REFERENCES activities (id) ON DELETE CASCADE
);

-- Indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_activities_start_time ON activities(start_time);
CREATE INDEX IF NOT EXISTS idx_activities_type ON activities(type);
CREATE INDEX IF NOT EXISTS idx_activities_created_at ON activities(created_at);
CREATE INDEX IF NOT EXISTS idx_exercise_sets_activity_id ON exercise_sets(activity_id);
CREATE INDEX IF NOT EXISTS idx_exercise_sets_exercise_name ON exercise_sets(exercise_name);

-- Sync metadata table (alternative to KV store)
CREATE TABLE IF NOT EXISTS sync_metadata (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
