import {
  CALIBRATION_STEPS,
  beginCalibration,
  cancelCalibration,
  leaveCalibration,
  noteSteps,
  parseCourseMeters,
  stepsTowardCalibration,
  type CalibrationSession,
} from '@/calibration/session';

const idle: CalibrationSession = { phase: 'idle', steps: 0 };
const walking: CalibrationSession = { phase: 'walking', steps: 4 };

describe('stepsTowardCalibration', () => {
  test('the 12-step demo at Start is not progress', () => {
    expect(stepsTowardCalibration(12, 12)).toBe(0);
  });

  test('a live count that replaces the demo is the walk', () => {
    expect(stepsTowardCalibration(12, 0)).toBe(0);
    expect(stepsTowardCalibration(12, 4)).toBe(4);
    expect(stepsTowardCalibration(12, CALIBRATION_STEPS)).toBe(10);
  });

  test('an engine that is already live counts the increase', () => {
    expect(stepsTowardCalibration(4, 4)).toBe(0);
    expect(stepsTowardCalibration(4, 9)).toBe(5);
    expect(stepsTowardCalibration(0, 3)).toBe(3);
    expect(stepsTowardCalibration(4, 14)).toBe(10);
  });

  test('a non-finite or non-positive count is no progress', () => {
    expect(stepsTowardCalibration(0, Number.NaN)).toBe(0);
    expect(stepsTowardCalibration(0, Number.POSITIVE_INFINITY)).toBe(0);
    expect(stepsTowardCalibration(Number.NaN, 0)).toBe(0);
    expect(stepsTowardCalibration(0, -3)).toBe(0);
  });

  test('a missing baseline falls back to the live count', () => {
    expect(stepsTowardCalibration(Number.NaN, 3)).toBe(3);
  });
});

describe('parseCourseMeters', () => {
  test('a positive length is the course', () => {
    expect(parseCourseMeters('8')).toBe(8);
    expect(parseCourseMeters(' 12.5 ')).toBe(12.5);
  });

  test('blank, zero, and words are not a course', () => {
    expect(parseCourseMeters('')).toBeNull();
    expect(parseCourseMeters('   ')).toBeNull();
    expect(parseCourseMeters('0')).toBeNull();
    expect(parseCourseMeters('-3')).toBeNull();
    expect(parseCourseMeters('hallway')).toBeNull();
  });
});

describe('calibration session', () => {
  test('start, progress, and the tenth step', () => {
    const started = beginCalibration(idle);
    expect(started).toEqual({ phase: 'walking', steps: 0 });
    const mid = noteSteps(started, 4);
    expect(mid).toEqual({ phase: 'walking', steps: 4 });
    expect(noteSteps(mid, 4)).toBe(mid);
    expect(noteSteps(mid, 9)).toEqual({ phase: 'walking', steps: 9 });
    expect(noteSteps(mid, 10)).toEqual({ phase: 'done', steps: 10 });
    expect(noteSteps(mid, 12.8)).toEqual({ phase: 'done', steps: 10 });
  });

  test('cancel and leave drop an in-progress walk and keep a finished one', () => {
    expect(cancelCalibration(walking)).toEqual(idle);
    expect(leaveCalibration(walking)).toEqual(idle);
    const done: CalibrationSession = { phase: 'done', steps: 10 };
    expect(cancelCalibration(done)).toBe(done);
    expect(leaveCalibration(done)).toBe(done);
    expect(beginCalibration(done)).toBe(done);
    expect(beginCalibration(walking)).toBe(walking);
    expect(noteSteps(idle, 10)).toBe(idle);
    expect(noteSteps(done, 0)).toBe(done);
  });
});
