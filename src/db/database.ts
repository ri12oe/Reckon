import { openDatabaseSync, type SQLiteDatabase } from 'expo-sqlite';

import { applyFloorSchema } from '@/db/schema';

let database: SQLiteDatabase | null = null;

export function getDatabase(): SQLiteDatabase | null {
  if (!database) {
    database = openDatabaseSync('floorwalker.db');
    applyFloorSchema(database);
  }
  return database;
}

export function ensureDatabase(): Promise<SQLiteDatabase | null> {
  return Promise.resolve(getDatabase());
}
