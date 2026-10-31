import { getDatabase } from '@/db/database';

export type AppearancePreference = 'system' | 'light' | 'dark';

const CREATE_TABLE = `CREATE TABLE IF NOT EXISTS appearance (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  preference TEXT NOT NULL
)`;

type PreferenceDb = {
  execSync(source: string): void;
  runSync(source: string, ...params: unknown[]): unknown;
  getFirstSync<T>(source: string, ...params: unknown[]): T | null;
};

/**
 * Web's database shim returns null until it opens, so the choice lives in memory there.
 * A failed native write does the same for the rest of this session.
 */
let memoryPreference: AppearancePreference = 'system';

export function isAppearancePreference(value: unknown): value is AppearancePreference {
  return value === 'system' || value === 'light' || value === 'dark';
}

function open(): PreferenceDb | null {
  const db = getDatabase();
  if (!db || typeof db.execSync !== 'function') return null;
  return db;
}

export function readAppearance(): AppearancePreference {
  const db = open();
  if (!db) return memoryPreference;
  try {
    db.execSync(CREATE_TABLE);
    const row = db.getFirstSync<{ preference: string }>(
      'SELECT preference FROM appearance WHERE id = 1',
    );
    return isAppearancePreference(row?.preference) ? row.preference : memoryPreference;
  } catch {
    return memoryPreference;
  }
}

export function writeAppearance(preference: AppearancePreference): void {
  memoryPreference = preference;
  const db = open();
  if (!db) return;
  try {
    db.execSync(CREATE_TABLE);
    db.runSync('INSERT OR REPLACE INTO appearance (id, preference) VALUES (1, ?)', preference);
  } catch {
    // Kept in memory above.
  }
}
