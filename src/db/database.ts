import { openDatabaseSync, type SQLiteDatabase } from 'expo-sqlite';

import { FLOOR_SCHEMA } from '@/db/schema';

let database: SQLiteDatabase | null = null;

export function getDatabase(): SQLiteDatabase | null {
  if (!database) {
    database = openDatabaseSync('floorwalker.db');
    database.execSync(FLOOR_SCHEMA);
  }
  return database;
}

export function ensureDatabase(): Promise<SQLiteDatabase | null> {
  return Promise.resolve(getDatabase());
}
