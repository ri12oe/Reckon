import { getDatabase } from '@/db/database';

const CREATE_TABLE = `CREATE TABLE IF NOT EXISTS calibration (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  calibrated INTEGER NOT NULL
)`;

type FlagDb = {
  execSync(source: string): void;
  runSync(source: string, ...params: unknown[]): unknown;
  getFirstSync<T>(source: string, ...params: unknown[]): T | null;
};

/**
 * Web's database shim returns null, so the flag lives in memory there.
 * A failed native write does the same for the rest of this session.
 */
let memoryCalibrated = false;

function open(): FlagDb | null {
  const db = getDatabase();
  if (!db || typeof db.execSync !== 'function') return null;
  return db;
}

function ensure(db: FlagDb): void {
  db.execSync(CREATE_TABLE);
}

export function isCalibrated(): boolean {
  const db = open();
  if (!db) return memoryCalibrated;
  try {
    ensure(db);
    const row = db.getFirstSync<{ calibrated: number }>(
      'SELECT calibrated FROM calibration WHERE id = 1',
    );
    return row?.calibrated === 1;
  } catch {
    return memoryCalibrated;
  }
}

export function markCalibrated(): void {
  const db = open();
  if (!db) {
    memoryCalibrated = true;
    return;
  }
  try {
    ensure(db);
    db.runSync('INSERT OR REPLACE INTO calibration (id, calibrated) VALUES (1, 1)');
  } catch {
    memoryCalibrated = true;
  }
}
