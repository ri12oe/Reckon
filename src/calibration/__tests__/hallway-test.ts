import { createHallwayCalibration } from '@/calibration/hallway';
import {
  CALIBRATION_STEPS,
  beginCalibration,
  type CalibrationSession,
} from '@/calibration/session';
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

const idle: CalibrationSession = { phase: 'idle', steps: 0 };

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

function openRun(courseMeters: number) {
  const calibration = createLiveEngine();
  const live = createLiveEngine();
  const run = createHallwayCalibration({
    courseMeters,
    measure: (course, steps) => calibration.calibrateStepLength(course, steps),
    live,
  });
  return { calibration, live, run };
}

describe('hallway calibration', () => {
  beforeEach(() => {
    state.db = memoryDb();
  });

  test('polling detected steps never finishes or saves', () => {
    const { calibration, live, run } = openRun(15);
    let session = beginCalibration(idle);
    session = run.poll(session, CALIBRATION_STEPS);
    session = run.poll(session, 22);
    expect(session).toEqual({ phase: 'walking', steps: 22 });
    expect(isCalibrated()).toBe(false);
    expect(readStepLength()).toBeNull();
    expect(live.getStepLength()).toBe(0.75);
    expect(calibration.getStepLength()).toBe(0.75);
  });

  test('marking the end under 10 steps stays walking', () => {
    const { live, run } = openRun(15);
    const walked = run.poll(beginCalibration(idle), 6);
    const ended = run.end(walked, 9);
    expect(ended.session).toEqual({ phase: 'walking', steps: 9 });
    expect(ended.saved).toBeNull();
    expect(ended.status).toBe(`Walk at least ${CALIBRATION_STEPS} steps, then mark the end.`);
    expect(isCalibrated()).toBe(false);
    expect(live.getStepLength()).toBe(0.75);
  });

  test('marking the end at or above 10 steps saves the detected count', () => {
    const minimum = openRun(8);
    const minimumWalk = minimum.run.poll(beginCalibration(idle), 4);
    const minimumEnd = minimum.run.end(minimumWalk, CALIBRATION_STEPS);
    expect(minimumEnd.session).toEqual({ phase: 'done', steps: 10 });
    expect(minimumEnd.status).toBe('');
    expect(minimumEnd.saved).toEqual({ stepLengthM: 0.8, distanceM: 8, stepCount: 10 });
    expect(readStepLength()).toEqual(minimumEnd.saved);
    expect(minimum.live.getStepLength()).toBe(0.8);

    state.db = memoryDb();
    const hallway = openRun(15);
    const walked = hallway.run.poll(beginCalibration(idle), 9);
    expect(walked).toEqual({ phase: 'walking', steps: 9 });
    expect(readStepLength()).toBeNull();
    const ended = hallway.run.end(walked, 16);
    const expected = { stepLengthM: 15 / 16, distanceM: 15, stepCount: 16 };
    expect(ended.session).toEqual({ phase: 'done', steps: 16 });
    expect(ended.status).toBe('');
    expect(ended.saved).toEqual(expected);
    expect(readStepLength()).toEqual(expected);
    expect(hallway.live.getStepLength()).toBe(15 / 16);
    expect(hallway.calibration.getStepLength()).toBe(15 / 16);
  });

  test('an unusable course leaves the walk idle and unsaved', () => {
    const calibration = createLiveEngine();
    const live = createLiveEngine();
    const run = createHallwayCalibration({
      courseMeters: 0,
      measure: (course, steps) => calibration.calibrateStepLength(course, steps),
      live,
    });
    const ended = run.end(run.poll(beginCalibration(idle), 12), 12);
    expect(ended.session).toEqual({ phase: 'idle', steps: 0 });
    expect(ended.saved).toBeNull();
    expect(ended.status).toBe('That distance did not update step length.');
    expect(isCalibrated()).toBe(false);
    expect(live.getStepLength()).toBe(0.75);
  });
});
