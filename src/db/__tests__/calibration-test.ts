const state: { db: FakeDb | null } = { db: null };

jest.mock('@/db/database', () => ({
  getDatabase: () => state.db,
}));

type FakeDb = {
  execSync(source: string): void;
  runSync(source: string, ...params: unknown[]): unknown;
  getFirstSync<T>(source: string, ...params: unknown[]): T | null;
};

type CalibrationStore = {
  isCalibrated(): boolean;
  markCalibrated(): void;
};

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

function memoryDb(): FakeDb {
  let ready = false;
  let calibrated: number | null = null;
  return {
    execSync(source) {
      if (!source.includes('CREATE TABLE') || !source.includes('calibration')) {
        throw new Error(`unexpected exec: ${source}`);
      }
      ready = true;
    },
    runSync(source) {
      if (!ready) throw new Error('no table');
      if (!source.includes('INSERT') || !source.includes('calibration')) {
        throw new Error(`unexpected run: ${source}`);
      }
      calibrated = 1;
      return { changes: 1, lastInsertRowId: 1 };
    },
    getFirstSync<T>(): T | null {
      if (!ready) throw new Error('no table');
      if (calibrated === null) return null;
      return { calibrated } as T;
    },
  };
}

describe('calibration flag', () => {
  test('a fresh database is not calibrated, and mark keeps the flag', () => {
    state.db = memoryDb();
    const { isCalibrated, markCalibrated } = loadStore();
    expect(isCalibrated()).toBe(false);
    markCalibrated();
    expect(isCalibrated()).toBe(true);
    expect(isCalibrated()).toBe(true);
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
    const { isCalibrated, markCalibrated } = loadStore();
    expect(isCalibrated()).toBe(false);
    expect(() => markCalibrated()).not.toThrow();
    expect(isCalibrated()).toBe(true);
  });

  test('without a database the flag is remembered in this session', () => {
    state.db = null;
    const { isCalibrated, markCalibrated } = loadStore();
    expect(isCalibrated()).toBe(false);
    markCalibrated();
    expect(isCalibrated()).toBe(true);
  });
});
