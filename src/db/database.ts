import { openDatabaseSync, type SQLiteDatabase } from 'expo-sqlite';

import { FLOOR_SCHEMA } from '@/db/schema';

let database: SQLiteDatabase | null = null;

/**
 * Opens the local database and creates building, floor, path, and pin tables.
 * The web build returns null; callers keep floors in memory instead.
 */
export function getDatabase(): SQLiteDatabase | null {
  if (!database) {
    database = openDatabaseSync('floorwalker.db');
    database.execSync(FLOOR_SCHEMA);
  }
  return database;
}
