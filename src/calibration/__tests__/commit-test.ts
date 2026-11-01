import { commitStepLength } from '@/calibration/commit';
import { isCalibrated, readStepLength } from '@/db/calibration';
import { createLiveEngine } from '@/engine/live-engine';

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

function memoryDb(): FakeDb {
  let ready = false;
  let row: CalibrationRow | null = null;
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

function east(engine: ReturnType<typeof createLiveEngine>, t: number) {
  engine.pushStep({ t, heading: 90 });
}

describe('commitStepLength', () => {
  test('before calibration one east step ends at 0.75 m; after 5 m / 8 steps a relaunch ends at 0.625 m', () => {
    state.db = memoryDb();

    const live = createLiveEngine();
    expect(live.getStepLength()).toBe(0.75);
    east(live, 100);
    expect(live.getSnapshot().stepCount).toBe(1);
    expect(live.getSnapshot().rawPath[1]!.x).toBe(0.75);

    const calibration = createLiveEngine();
    for (let i = 0; i < 8; i++) east(calibration, (i + 1) * 400);
    const estimate = calibration.calibrateStepLength(5);
    expect(estimate).toEqual({ stepLengthM: 0.625, distanceM: 5, stepCount: 8 });
    expect(calibration.getSnapshot().stepCount).toBe(8);
    expect(calibration.getSnapshot().rawPath[8]!.x).toBe(5);

    const saved = commitStepLength(estimate, live);
    expect(saved).toEqual(estimate);
    expect(isCalibrated()).toBe(true);
    expect(readStepLength()).toEqual(estimate);
    expect(live.getStepLength()).toBe(0.625);
    expect(live.getSnapshot().stepCount).toBe(1);
    expect(live.getSnapshot().rawPath[1]!.x).toBe(0.625);
    expect(live.getSnapshot().rawPath).toHaveLength(2);

    jest.isolateModules(() => {
      // isolateModules only accepts a synchronous factory.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { getEngine } = require('@/engine') as typeof import('@/engine');
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const store = require('@/db/calibration') as typeof import('@/db/calibration');
      expect(store.isCalibrated()).toBe(true);
      const restarted = getEngine();
      expect(restarted.getStepLength()).toBe(0.625);
      restarted.pushStep({ t: 100, heading: 90 });
      expect(restarted.getSnapshot().stepCount).toBe(1);
      expect(restarted.getSnapshot().rawPath[1]!.x).toBe(0.625);
    });
  });

  test('getEngine applies a saved length once the database opens', () => {
    state.db = null;
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { getEngine } = require('@/engine') as typeof import('@/engine');
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const store = require('@/db/calibration') as typeof import('@/db/calibration');
      const early = getEngine();
      expect(early.getStepLength()).toBe(0.75);
      expect(store.calibrationDatabaseOpen()).toBe(false);

      state.db = memoryDb();
      expect(store.saveStepLength({ stepLengthM: 0.625, distanceM: 5, stepCount: 8 })).toEqual({
        stepLengthM: 0.625,
        distanceM: 5,
        stepCount: 8,
      });
      const live = getEngine();
      expect(live).toBe(early);
      expect(live.getStepLength()).toBe(0.625);
      live.pushStep({ t: 100, heading: 90 });
      expect(live.getSnapshot().rawPath[1]!.x).toBe(0.625);
    });
  });

  test('a null estimate does not mark calibrated and a relaunch stays at 0.75 m', () => {
    state.db = memoryDb();
    const live = createLiveEngine();
    east(live, 100);
    expect(live.calibrateStepLength(0)).toBeNull();
    expect(live.calibrateStepLength(5, 0)).toBeNull();
    expect(commitStepLength(null, live)).toBeNull();
    expect(isCalibrated()).toBe(false);
    expect(readStepLength()).toBeNull();
    expect(live.getStepLength()).toBe(0.75);
    expect(live.getSnapshot().rawPath[1]!.x).toBe(0.75);

    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { getEngine } = require('@/engine') as typeof import('@/engine');
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const store = require('@/db/calibration') as typeof import('@/db/calibration');
      expect(store.isCalibrated()).toBe(false);
      const restarted = getEngine();
      expect(restarted.getStepLength()).toBe(0.75);
      restarted.pushStep({ t: 100, heading: 90 });
      expect(restarted.getSnapshot().rawPath[1]!.x).toBe(0.75);
    });
  });
});
