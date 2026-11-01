const state: { db: FakeDb | null } = { db: null };

jest.mock('@/db/database', () => ({
  getDatabase: () => state.db,
}));

type FakeDb = {
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

type CalibrationStore = typeof import('@/db/calibration');

function loadStore(): CalibrationStore {
  let store: CalibrationStore | undefined;
  jest.isolateModules(() => {
    // isolateModules only accepts a synchronous factory.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    store = require('@/db/calibration') as CalibrationStore;
  });
  if (!store) throw new Error('calibration store did not load');
  return store;
}

function memoryDb(initial: CalibrationRow | null = null): FakeDb {
  let ready = false;
  let row = initial;
  return {
    execSync(source) {
      if (source.includes('ALTER TABLE') && source.includes('calibration')) return;
      if (!source.includes('CREATE TABLE') || !source.includes('calibration')) {
        throw new Error(`unexpected exec: ${source}`);
      }
      ready = true;
    },
    runSync(source, ...params) {
      if (!ready) throw new Error('no table');
      if (!source.includes('INSERT') || !source.includes('step_length_m')) {
        throw new Error(`unexpected run: ${source}`);
      }
      const [stepLengthM, distanceM, stepCount] = params;
      row = {
        calibrated: 1,
        step_length_m: stepLengthM as number,
        distance_m: distanceM as number,
        step_count: stepCount as number,
      };
      return { changes: 1, lastInsertRowId: 1 };
    },
    getFirstSync<T>(): T | null {
      if (!ready) throw new Error('no table');
      if (!row) return null;
      return { ...row } as T;
    },
  };
}

const eightOverFive = { stepLengthM: 0.625, distanceM: 5, stepCount: 8 };

describe('calibration store', () => {
  test('a fresh database is not calibrated, and a real estimate is kept', () => {
    state.db = memoryDb();
    const { isCalibrated, readStepLength, saveStepLength } = loadStore();
    expect(isCalibrated()).toBe(false);
    expect(readStepLength()).toBeNull();
    expect(saveStepLength(eightOverFive)).toEqual(eightOverFive);
    expect(isCalibrated()).toBe(true);
    expect(readStepLength()).toEqual(eightOverFive);
    expect(saveStepLength({ stepLengthM: 0.7, distanceM: 7, stepCount: 10 })).toEqual({
      stepLengthM: 0.7,
      distanceM: 7,
      stepCount: 10,
    });
    expect(readStepLength()?.stepLengthM).toBe(0.7);
  });

  test('a null or unusable estimate does not mark the walker calibrated', () => {
    state.db = memoryDb();
    const { isCalibrated, readStepLength, saveStepLength } = loadStore();
    expect(saveStepLength(null)).toBeNull();
    expect(saveStepLength({ stepLengthM: 1, distanceM: 0, stepCount: 4 })).toBeNull();
    expect(saveStepLength({ stepLengthM: 1, distanceM: 5, stepCount: 0 })).toBeNull();
    expect(saveStepLength({ stepLengthM: Number.NaN, distanceM: 5, stepCount: 8 })).toBeNull();
    expect(isCalibrated()).toBe(false);
    expect(readStepLength()).toBeNull();
  });

  test('a calibrated flag with no step length is not calibrated', () => {
    state.db = memoryDb({
      calibrated: 1,
      step_length_m: null,
      distance_m: null,
      step_count: null,
    });
    const { isCalibrated, readStepLength } = loadStore();
    expect(isCalibrated()).toBe(false);
    expect(readStepLength()).toBeNull();
  });

  test('a database that cannot be read does not throw', () => {
    state.db = {
      execSync() {
        throw new Error('disk');
      },
      runSync() {
        throw new Error('disk');
      },
      getFirstSync() {
        throw new Error('disk');
      },
    };
    const { isCalibrated, readStepLength, saveStepLength } = loadStore();
    expect(isCalibrated()).toBe(false);
    expect(() => saveStepLength(eightOverFive)).not.toThrow();
    expect(saveStepLength(eightOverFive)).toEqual(eightOverFive);
    expect(isCalibrated()).toBe(true);
    expect(readStepLength()).toEqual(eightOverFive);
  });

  test('without a database the estimate is remembered in this session', () => {
    state.db = null;
    const { calibrationDatabaseOpen, isCalibrated, readStepLength, saveStepLength } = loadStore();
    expect(calibrationDatabaseOpen()).toBe(false);
    expect(isCalibrated()).toBe(false);
    saveStepLength(eightOverFive);
    expect(isCalibrated()).toBe(true);
    expect(readStepLength()).toEqual(eightOverFive);
  });
});
