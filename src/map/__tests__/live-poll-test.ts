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

const savedLength: CalibrationRow = {
  calibrated: 1,
  step_length_m: 0.625,
  distance_m: 5,
  step_count: 8,
};

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

function east(engine: { pushStep(step: { t: number; heading: number }): void }, t: number) {
  engine.pushStep({ t, heading: 90 });
}

describe('map poll after a late database open', () => {
  test('a step taken after a late open draws the saved length while the map stays focused', () => {
    state.db = null;
    jest.isolateModules(() => {
      // isolateModules only accepts a synchronous factory.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { createMapPoll } = require('@/map/live-poll') as typeof import('@/map/live-poll');
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { getEngine } = require('@/engine') as typeof import('@/engine');
      const poll = createMapPoll();
      const engine = getEngine();
      expect(engine.getStepLength()).toBe(0.75);
      east(engine, 100);
      const stepped = poll();
      expect(stepped.stepCount).toBe(1);
      expect(stepped.rawPath[1]!.x).toBe(0.75);
      expect(stepped.correctedPath[1]!.x).toBe(0.75);

      state.db = memoryDb(savedLength);
      const opened = poll();
      expect(opened.rawPath[1]!.x).toBe(0.75);
      expect(opened.correctedPath[1]!.x).toBe(0.75);
      east(engine, 200);
      const drawn = poll();
      expect(drawn.stepCount).toBe(2);
      expect(drawn.rawPath[1]!.x).toBe(0.75);
      expect(drawn.correctedPath[1]!.x).toBe(0.75);
      expect(drawn.rawPath[2]!.x).toBe(1.375);
      expect(drawn.correctedPath[2]!.x).toBe(1.375);
    });
  });

  test('a database that is already open applies the saved length on the first poll', () => {
    state.db = memoryDb(savedLength);
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { createMapPoll } = require('@/map/live-poll') as typeof import('@/map/live-poll');
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { getEngine } = require('@/engine') as typeof import('@/engine');
      const poll = createMapPoll();
      const engine = getEngine();
      expect(engine.getStepLength()).toBe(0.625);
      east(engine, 100);
      const drawn = poll();
      expect(drawn.stepCount).toBe(1);
      expect(drawn.rawPath[1]!.x).toBe(0.625);
      expect(drawn.correctedPath[1]!.x).toBe(0.625);
    });
  });

  test('a late open with no saved length leaves the default 0.75 m step', () => {
    state.db = null;
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { createMapPoll } = require('@/map/live-poll') as typeof import('@/map/live-poll');
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { getEngine } = require('@/engine') as typeof import('@/engine');
      const poll = createMapPoll();
      const engine = getEngine();
      east(engine, 100);
      const stepped = poll();
      expect(stepped.rawPath[1]!.x).toBe(0.75);
      expect(stepped.correctedPath[1]!.x).toBe(0.75);
      state.db = memoryDb();
      east(engine, 200);
      const live = poll();
      expect(engine.getStepLength()).toBe(0.75);
      expect(live.stepCount).toBe(2);
      expect(live.rawPath[2]!.x).toBe(1.5);
      expect(live.correctedPath[2]!.x).toBe(1.5);
    });
  });
});
