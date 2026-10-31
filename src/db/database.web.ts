import { openDatabaseAsync, type SQLiteDatabase } from 'expo-sqlite';

import { FLOOR_SCHEMA } from '@/db/schema';

let database: SQLiteDatabase | null = null;
let pending: Promise<SQLiteDatabase | null> | null = null;

export function getDatabase(): SQLiteDatabase | null {
  return database;
}

/**
 * Needs a secure context and the COOP/COEP headers that expose `SharedArrayBuffer`.
 * One tab at a time.
 */
export function ensureDatabase(): Promise<SQLiteDatabase | null> {
  if (typeof window === 'undefined') return Promise.resolve(null);
  if (database) return Promise.resolve(database);
  pending ??= openDatabaseAsync('floorwalker.db')
    .then((opened) => {
      opened.execSync(FLOOR_SCHEMA);
      database = opened;
      return opened;
    })
    .catch(() => {
      pending = null;
      return null;
    });
  return pending;
}
