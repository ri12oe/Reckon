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
