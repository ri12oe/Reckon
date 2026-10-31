/**
 * Buildings, floors, path points, and pins.
 * `execSync` this on open. Every statement is idempotent.
 */
export const FLOOR_SCHEMA = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS buildings (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS floors (
  id TEXT PRIMARY KEY NOT NULL,
  building_id TEXT NOT NULL,
  name TEXT NOT NULL,
  step_count INTEGER NOT NULL,
  heading REAL NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (building_id) REFERENCES buildings (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS path_points (
  floor_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('raw', 'corrected')),
  seq INTEGER NOT NULL,
  x REAL NOT NULL,
  y REAL NOT NULL,
  t REAL NOT NULL,
  PRIMARY KEY (floor_id, kind, seq),
  FOREIGN KEY (floor_id) REFERENCES floors (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS pins (
  floor_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  id TEXT NOT NULL,
  x REAL NOT NULL,
  y REAL NOT NULL,
  label TEXT NOT NULL,
  PRIMARY KEY (floor_id, seq),
  FOREIGN KEY (floor_id) REFERENCES floors (id) ON DELETE CASCADE
);
`;
