import { getDatabase } from '@/db/database';
import { estimateStepLength, type StepLengthEstimate } from '@/engine/step-length';

const CREATE_TABLE = `CREATE TABLE IF NOT EXISTS calibration (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  calibrated INTEGER NOT NULL,
  step_length_m REAL,
  distance_m REAL,
  step_count INTEGER
)`;

const ADD_COLUMNS = [
  'ALTER TABLE calibration ADD COLUMN step_length_m REAL',
  'ALTER TABLE calibration ADD COLUMN distance_m REAL',
  'ALTER TABLE calibration ADD COLUMN step_count INTEGER',
];

const SELECT_ROW =
  'SELECT calibrated, step_length_m, distance_m, step_count FROM calibration WHERE id = 1';

const UPSERT_ROW =
  'INSERT OR REPLACE INTO calibration (id, calibrated, step_length_m, distance_m, step_count) VALUES (1, 1, ?, ?, ?)';

type FlagDb = {
  execSync(source: string): void;
  runSync(source: string, ...params: unknown[]): unknown;
  getFirstSync<T>(source: string, ...params: unknown[]): T | null;
};

type CalibrationRow = {
  calibrated: number;
  step_length_m: number | null;
  distance_m: number | null;
  step_count: number | null;
};

/**
 * Web's database shim returns null until it opens, so the estimate lives in
 * memory there. A failed native write does the same for the rest of this session.
 */
let memoryEstimate: StepLengthEstimate | null = null;

function open(): FlagDb | null {
  try {
    const db = getDatabase();
    if (!db || typeof db.execSync !== 'function') return null;
    return db;
  } catch {
    return null;
  }
}

function ensure(db: FlagDb): void {
  db.execSync(CREATE_TABLE);
  for (const statement of ADD_COLUMNS) {
    try {
      db.execSync(statement);
    } catch {
      // The column is already on a database created with the current table.
    }
  }
}

function parseRow(row: CalibrationRow | null): StepLengthEstimate | null {
  if (!row || row.calibrated !== 1) return null;
  if (row.distance_m === null || row.step_count === null || row.step_length_m === null) return null;
  const checked = estimateStepLength({ distanceM: row.distance_m, stepCount: row.step_count });
  if (!checked) return null;
  if (!Number.isFinite(row.step_length_m) || row.step_length_m <= 0) return null;
  return {
    stepLengthM: row.step_length_m,
    distanceM: checked.distanceM,
    stepCount: checked.stepCount,
  };
}

export function calibrationDatabaseOpen(): boolean {
  return open() !== null;
}

export function readStepLength(): StepLengthEstimate | null {
  const db = open();
  if (!db) return memoryEstimate;
  try {
    ensure(db);
    const parsed = parseRow(db.getFirstSync<CalibrationRow>(SELECT_ROW));
    if (parsed) memoryEstimate = parsed;
    return parsed;
  } catch {
    return memoryEstimate;
  }
}

/** Null and unusable walks are ignored, so a failed calibration does not count. */
export function saveStepLength(estimate: StepLengthEstimate | null): StepLengthEstimate | null {
  if (!estimate) return null;
  const checked = estimateStepLength({
    distanceM: estimate.distanceM,
    stepCount: estimate.stepCount,
  });
  if (!checked || !Number.isFinite(estimate.stepLengthM) || estimate.stepLengthM <= 0) return null;
  const stored: StepLengthEstimate = {
    stepLengthM: estimate.stepLengthM,
    distanceM: checked.distanceM,
    stepCount: checked.stepCount,
  };
  memoryEstimate = stored;
  const db = open();
  if (!db) return stored;
  try {
    ensure(db);
    db.runSync(UPSERT_ROW, stored.stepLengthM, stored.distanceM, stored.stepCount);
  } catch {
    // Kept in memory above.
  }
  return stored;
}

export function isCalibrated(): boolean {
  return readStepLength() !== null;
}
