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

describe('walk poll after a late database open', () => {
  test('a step taken after a late open uses the saved length while the earlier step stays', () => {
    state.db = null;
    jest.isolateModules(() => {
      // isolateModules only accepts a synchronous factory.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { createWalkPoll } = require('@/walk/live-poll') as typeof import('@/walk/live-poll');
      const poll = createWalkPoll();
      const early = poll([]);
      expect(early.engine.getStepLength()).toBe(0.75);
      east(early.engine, 100);
      const stepped = poll([]);
      expect(stepped.engine).toBe(early.engine);
      expect(stepped.view.shown.stepCount).toBe(1);
      expect(stepped.view.shown.rawPath[1]!.x).toBe(0.75);
      expect(stepped.view.shown.correctedPath[1]!.x).toBe(0.75);

      state.db = memoryDb(savedLength);
      const opened = poll([]);
      expect(opened.engine).toBe(early.engine);
      expect(opened.engine.getStepLength()).toBe(0.625);
      expect(opened.view.shown.stepCount).toBe(1);
      expect(opened.view.shown.rawPath[1]!.x).toBe(0.75);
      expect(opened.view.shown.correctedPath[1]!.x).toBe(0.75);
      east(opened.engine, 200);
      const live = poll([]);
      expect(live.engine).toBe(early.engine);
      expect(live.view.shown.stepCount).toBe(2);
      expect(live.view.shown.rawPath[1]!.x).toBe(0.75);
      expect(live.view.shown.correctedPath[1]!.x).toBe(0.75);
      expect(live.view.shown.rawPath[2]!.x).toBe(1.375);
      expect(live.view.shown.correctedPath[2]!.x).toBe(1.375);
    });
  });

  test('a database that is already open applies the saved length on the first poll', () => {
    state.db = memoryDb(savedLength);
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { createWalkPoll } = require('@/walk/live-poll') as typeof import('@/walk/live-poll');
      const poll = createWalkPoll();
      const first = poll([]);
      expect(first.engine.getStepLength()).toBe(0.625);
      east(first.engine, 100);
      const again = poll([]);
      expect(again.engine).toBe(first.engine);
      expect(again.view.shown.stepCount).toBe(1);
      expect(again.view.shown.rawPath[1]!.x).toBe(0.625);
    });
  });

  test('a late open with no saved length leaves the default 0.75 m step', () => {
    state.db = null;
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { createWalkPoll } = require('@/walk/live-poll') as typeof import('@/walk/live-poll');
      const poll = createWalkPoll();
      const early = poll([]);
      east(early.engine, 100);
      const stepped = poll([]);
      expect(stepped.view.shown.rawPath[1]!.x).toBe(0.75);
      state.db = memoryDb();
      const live = poll([]);
      expect(live.engine).toBe(early.engine);
      expect(live.engine.getStepLength()).toBe(0.75);
      expect(live.view.shown.rawPath[1]!.x).toBe(0.75);
    });
  });
});
