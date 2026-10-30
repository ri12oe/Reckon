import { openDatabaseSync, type SQLiteDatabase } from 'expo-sqlite';

let database: SQLiteDatabase | null = null;

/** Opens the local database. Walk, path, and pin tables are not created yet. */
export function getDatabase(): SQLiteDatabase {
  if (!database) {
    database = openDatabaseSync('floorwalker.db');
  }
  return database;
}
