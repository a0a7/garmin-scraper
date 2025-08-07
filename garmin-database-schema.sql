-- Updated D1 Database Schema for Garmin Activities
-- Run these SQL commands in your Cloudflare D1 database

-- Drop existing tables if you want to recreate (optional - be careful!)
-- DROP TABLE IF EXISTS exercise_sets;
-- DROP TABLE IF EXISTS activities;

-- Main activities table with enhanced fields
CREATE TABLE IF NOT EXISTS activities (
    id INTEGER PRIMARY KEY,
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
    average_power INTEGER,
    max_power INTEGER,
    normalized_power INTEGER,
    training_stress_score REAL,
    average_cadence REAL,
    max_cadence REAL,
    total_reps INTEGER,
    total_sets INTEGER,
    
    -- GPS/Route data
    gps_polyline TEXT,
    start_latitude REAL,
    start_longitude REAL,
    end_latitude REAL,
    end_longitude REAL,
    has_gps_data BOOLEAN DEFAULT FALSE,
    
    -- Weather data
    temperature REAL,
    apparent_temperature REAL,
    humidity INTEGER,
    dew_point REAL,
    wind_speed REAL,
    wind_direction INTEGER,
    wind_direction_compass TEXT,
    wind_gust REAL,
    weather_description TEXT,
    weather_station TEXT,
    weather_issue_date TEXT,
    has_weather_data BOOLEAN DEFAULT FALSE,
    
    -- Strength training timing data
    total_working_time INTEGER, -- seconds
    total_rest_time INTEGER, -- seconds
    work_to_rest_ratio REAL,
    work_percentage INTEGER,
    
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- Exercise sets table with enhanced timing
CREATE TABLE IF NOT EXISTS exercise_sets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    activity_id INTEGER NOT NULL,
    exercise_name TEXT NOT NULL,
    category TEXT,
    set_number INTEGER NOT NULL,
    reps INTEGER,
    weight REAL, -- in kg
    duration REAL, -- seconds
    start_time TEXT,
    total_working_time INTEGER, -- per exercise total working time
    total_reps INTEGER, -- per exercise total reps
    total_volume REAL, -- per exercise total volume (reps * weight)
    total_sets INTEGER, -- per exercise total sets
    created_at TEXT NOT NULL,
    FOREIGN KEY (activity_id) REFERENCES activities (id) ON DELETE CASCADE
);

-- Indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_activities_start_time ON activities(start_time);
CREATE INDEX IF NOT EXISTS idx_activities_type ON activities(type);
CREATE INDEX IF NOT EXISTS idx_activities_has_gps ON activities(has_gps_data);
CREATE INDEX IF NOT EXISTS idx_activities_has_weather ON activities(has_weather_data);
CREATE INDEX IF NOT EXISTS idx_exercise_sets_activity_id ON exercise_sets(activity_id);
CREATE INDEX IF NOT EXISTS idx_exercise_sets_exercise_name ON exercise_sets(exercise_name);

-- If you need to add these columns to existing tables:
/*
-- Add weather columns
ALTER TABLE activities ADD COLUMN temperature REAL;
ALTER TABLE activities ADD COLUMN apparent_temperature REAL;
ALTER TABLE activities ADD COLUMN humidity INTEGER;
ALTER TABLE activities ADD COLUMN dew_point REAL;
ALTER TABLE activities ADD COLUMN wind_speed REAL;
ALTER TABLE activities ADD COLUMN wind_direction INTEGER;
ALTER TABLE activities ADD COLUMN wind_direction_compass TEXT;
ALTER TABLE activities ADD COLUMN wind_gust REAL;
ALTER TABLE activities ADD COLUMN weather_description TEXT;
ALTER TABLE activities ADD COLUMN weather_station TEXT;
ALTER TABLE activities ADD COLUMN weather_issue_date TEXT;
ALTER TABLE activities ADD COLUMN has_weather_data BOOLEAN DEFAULT FALSE;

-- Add timing columns
ALTER TABLE activities ADD COLUMN total_working_time INTEGER;
ALTER TABLE activities ADD COLUMN total_rest_time INTEGER;
ALTER TABLE activities ADD COLUMN work_to_rest_ratio REAL;
ALTER TABLE activities ADD COLUMN work_percentage INTEGER;

-- Add timing columns to exercise_sets
ALTER TABLE exercise_sets ADD COLUMN total_working_time INTEGER;
*/
