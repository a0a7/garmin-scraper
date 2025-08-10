-- Table for storing encoded polylines for activities
CREATE TABLE IF NOT EXISTS activity_polylines (
  activity_id INTEGER PRIMARY KEY,
  polyline TEXT NOT NULL,
  FOREIGN KEY(activity_id) REFERENCES activities(id) ON DELETE CASCADE
);
