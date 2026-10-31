import { getDatabase } from '@/db/database';
import {
  createMemoryFloorStore,
  createSqliteFloorStore,
  type FloorStore,
  type SqlExecutor,
} from '@/db/floors';

let memory: FloorStore | null = null;
let sqliteStore: FloorStore | null = null;
let sqliteDb: SqlExecutor | null = null;

/**
 * Native builds write the floor tables. Web `getDatabase()` is null, so the
 * library keeps the same records in memory for the browser session.
 */
export function getFloorStore(): FloorStore {
  const db = getDatabase();
  if (!db) {
    memory ??= createMemoryFloorStore();
    return memory;
  }
  if (!sqliteStore || sqliteDb !== db) {
    sqliteDb = db;
    sqliteStore = createSqliteFloorStore(db);
  }
  return sqliteStore;
}
