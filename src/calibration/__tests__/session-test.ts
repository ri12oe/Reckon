import {
  CALIBRATION_STEPS,
  beginCalibration,
  cancelCalibration,
  endCalibration,
  leaveCalibration,
  noteSteps,
  parseCourseMeters,
  stepsTowardCalibration,
  type CalibrationSession,
} from '@/calibration/session';
import { estimateStepLength } from '@/engine/step-length';

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
  test('progress records every detected step and does not finish the walk', () => {
    const started = beginCalibration(idle);
    expect(started).toEqual({ phase: 'walking', steps: 0 });
    const mid = noteSteps(started, 4);
    expect(mid).toEqual({ phase: 'walking', steps: 4 });
    expect(noteSteps(mid, 4)).toBe(mid);
    expect(noteSteps(mid, 9)).toEqual({ phase: 'walking', steps: 9 });
    expect(noteSteps(mid, 10)).toEqual({ phase: 'walking', steps: 10 });
    expect(noteSteps(mid, 12.8)).toEqual({ phase: 'walking', steps: 12 });
    expect(noteSteps(mid, 20)).toEqual({ phase: 'walking', steps: 20 });
    expect(noteSteps(mid, Number.NaN)).toEqual({ phase: 'walking', steps: 0 });
  });

  test('the walker marks the end, and 10 steps is only the minimum', () => {
    const started = beginCalibration(idle);
    const short = noteSteps(started, 9);
    expect(endCalibration(short)).toBe(short);
    expect(endCalibration(idle)).toBe(idle);
    expect(endCalibration(walking)).toBe(walking);

    const minimum = noteSteps(started, 10);
    expect(endCalibration(minimum)).toEqual({ phase: 'done', steps: 10 });

    const hallway = noteSteps(started, 20);
    expect(hallway).toEqual({ phase: 'walking', steps: 20 });
    const done = endCalibration(hallway);
    expect(done).toEqual({ phase: 'done', steps: 20 });
    expect(endCalibration(done)).toBe(done);
    expect(noteSteps(done, 21)).toBe(done);
  });

  test('15 m over 20 detected steps is 0.75 m/step, not 1.5', () => {
    const done = endCalibration(noteSteps(beginCalibration(idle), 20));
    expect(done).toEqual({ phase: 'done', steps: 20 });
    expect(estimateStepLength({ distanceM: 15, stepCount: done.steps })).toEqual({
      stepLengthM: 0.75,
      distanceM: 15,
      stepCount: 20,
    });
    expect(estimateStepLength({ distanceM: 15, stepCount: CALIBRATION_STEPS })).toEqual({
      stepLengthM: 1.5,
      distanceM: 15,
      stepCount: 10,
    });
  });

  test('cancel and leave drop an in-progress walk and keep a finished one', () => {
    expect(cancelCalibration(walking)).toEqual(idle);
    expect(leaveCalibration(walking)).toEqual(idle);
    const done: CalibrationSession = { phase: 'done', steps: 20 };
    expect(cancelCalibration(done)).toBe(done);
    expect(leaveCalibration(done)).toBe(done);
    expect(beginCalibration(done)).toBe(done);
    expect(beginCalibration(walking)).toBe(walking);
    expect(noteSteps(idle, 20)).toBe(idle);
    expect(noteSteps(done, 0)).toBe(done);
  });
});
