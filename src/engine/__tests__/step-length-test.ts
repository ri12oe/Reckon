import {
  countCalibrationSteps,
  estimateStepLength,
  estimateStepLengthFromSteps,
  getEngine,
  stepLengthOrDefault,
} from '@/engine';
import { DEFAULT_STEP_LENGTH_M, integratePath } from '@/engine/path-integration';
import { STANDARD_GRAVITY_MPS2, detectSteps, type AccelSample } from '@/engine/step-detector';

const HZ = 50;
const DT_MS = 1000 / HZ;

function sampleTimes(startMs: number, endMs: number): number[] {
  const times: number[] = [];
  for (let t = startMs; t <= endMs; t += DT_MS) times.push(t);
  return times;
}

function hannBump(t: number, center: number, amplitude: number, halfWidthMs: number): number {
  const dt = t - center;
  if (Math.abs(dt) > halfWidthMs) return 0;
  return amplitude * 0.5 * (1 + Math.cos((Math.PI * dt) / halfWidthMs));
}

/** Vertical impacts at the planted times. Same synthesis as the step-detector tests. */
function verticalWalk(peakTimes: readonly number[]): AccelSample[] {
  const end = (peakTimes[peakTimes.length - 1] ?? 0) + 160 + 200;
  return sampleTimes(0, end).map((t) => {
    let bump = 0;
    for (const center of peakTimes) bump += hannBump(t, center, 3, 160);
    return { t, x: 0, y: 0, z: STANDARD_GRAVITY_MPS2 + bump };
  });
}

describe('estimateStepLength', () => {
  test('10 steps over 7.5 m is 0.75 m/step', () => {
    expect(estimateStepLength({ distanceM: 7.5, stepCount: 10 })).toEqual({
      stepLengthM: 0.75,
      distanceM: 7.5,
      stepCount: 10,
    });
  });

  test.each([
    [6, 10, 0.6],
    [8, 10, 0.8],
    [5, 8, 0.625],
    [3, 4, 0.75],
    [14, 20, 0.7],
    [9, 12, 0.75],
    [1, 1, 1],
    [20, 28, 0.7142857142857143],
    [65, 100, 0.65],
    [0.5, 1, 0.5],
    [100, 1, 100],
  ])('%s m over %s steps is %s m/step', (distanceM, stepCount, stepLengthM) => {
    const estimate = estimateStepLength({ distanceM, stepCount });
    expect(estimate).toEqual({ stepLengthM, distanceM, stepCount });
    expect(estimate!.stepLengthM * stepCount).toBe(distanceM);
  });

  test('a tiny positive ratio is kept; underflow to 0 is not an estimate', () => {
    expect(estimateStepLength({ distanceM: Number.MIN_VALUE, stepCount: 1 })).toEqual({
      stepLengthM: Number.MIN_VALUE,
      distanceM: Number.MIN_VALUE,
      stepCount: 1,
    });
    expect(estimateStepLength({ distanceM: Number.MIN_VALUE, stepCount: 2 })).toBeNull();
  });

  test.each([
    [0, 10],
    [-7.5, 10],
    [-0, 10],
    [7.5, 0],
    [7.5, -10],
    [7.5, -0],
    [7.5, 10.5],
    [7.5, 1.0000001],
    [Number.NaN, 10],
    [7.5, Number.NaN],
    [Number.POSITIVE_INFINITY, 10],
    [7.5, Number.POSITIVE_INFINITY],
    [Number.NEGATIVE_INFINITY, 1],
    [7.5, Number.NEGATIVE_INFINITY],
    [0, 0],
  ])('distance %s m and %s steps has no estimate', (distanceM, stepCount) => {
    expect(estimateStepLength({ distanceM, stepCount })).toBeNull();
  });
});

describe('countCalibrationSteps', () => {
  test('counts finite timestamps and ignores heading', () => {
    const steps = [
      { t: 400, heading: 90 },
      { t: Number.NaN, heading: 0 },
      { t: Number.POSITIVE_INFINITY },
      { t: 800 },
      { t: 800, heading: 180 },
    ];
    const before = steps.map((step) => ({ ...step }));

    expect(countCalibrationSteps(steps)).toBe(3);
    expect(steps).toEqual(before);
  });

  test('an empty list counts 0', () => {
    expect(countCalibrationSteps([])).toBe(0);
  });
});

describe('estimateStepLengthFromSteps', () => {
  test('10 step times over 7.5 m is 0.75 m/step', () => {
    const steps = Array.from({ length: 10 }, (_, i) => ({ t: (i + 1) * 400 }));
    expect(estimateStepLengthFromSteps(7.5, steps)).toEqual({
      stepLengthM: 0.75,
      distanceM: 7.5,
      stepCount: 10,
    });
  });

  test('a non-finite timestamp is dropped: 11 events over 7.5 m, one NaN, is still 0.75', () => {
    const steps = [
      ...Array.from({ length: 10 }, (_, i) => ({ t: (i + 1) * 400, heading: 90 })),
      { t: Number.NaN, heading: 90 },
    ];
    const before = steps.map((step) => ({ ...step }));

    expect(estimateStepLengthFromSteps(7.5, steps)).toEqual({
      stepLengthM: 0.75,
      distanceM: 7.5,
      stepCount: 10,
    });
    expect(steps).toEqual(before);
  });

  test('order does not matter', () => {
    const steps = [{ t: 1200 }, { t: 400 }, { t: 800 }];
    expect(estimateStepLengthFromSteps(2.25, steps)).toEqual({
      stepLengthM: 0.75,
      distanceM: 2.25,
      stepCount: 3,
    });
  });

  test('no finite step, or a bad distance, has no estimate', () => {
    expect(estimateStepLengthFromSteps(7.5, [])).toBeNull();
    expect(
      estimateStepLengthFromSteps(7.5, [{ t: Number.NaN }, { t: Number.POSITIVE_INFINITY }]),
    ).toBeNull();
    expect(estimateStepLengthFromSteps(0, [{ t: 400 }, { t: 800 }])).toBeNull();
    expect(estimateStepLengthFromSteps(-6, [{ t: 400 }])).toBeNull();
    expect(estimateStepLengthFromSteps(Number.NaN, [{ t: 400 }])).toBeNull();
  });
});

describe('stepLengthOrDefault', () => {
  test('no estimate is the 0.75 m default', () => {
    expect(DEFAULT_STEP_LENGTH_M).toBe(0.75);
    expect(stepLengthOrDefault(null)).toBe(0.75);
    expect(stepLengthOrDefault(null, Number.NaN)).toBe(0.75);
    expect(stepLengthOrDefault(null, Number.POSITIVE_INFINITY)).toBe(0.75);
  });

  test('a finite fallback replaces the default, and a real estimate wins', () => {
    expect(stepLengthOrDefault(null, 0.7)).toBe(0.7);
    expect(stepLengthOrDefault(null, 0)).toBe(0);

    const estimate = estimateStepLength({ distanceM: 5, stepCount: 8 });
    expect(estimate).toEqual({ stepLengthM: 0.625, distanceM: 5, stepCount: 8 });
    expect(stepLengthOrDefault(estimate, 0.75)).toBe(0.625);
    expect(stepLengthOrDefault({ stepLengthM: Number.NaN, distanceM: 5, stepCount: 8 }, 0.7)).toBe(
      0.7,
    );
  });
});

describe('calibration scales the integrated path', () => {
  test('before: 10 east steps at 0.75 m end at x = 7.5; after 10 steps over 6 m they end at x = 6', () => {
    const times = Array.from({ length: 10 }, (_, i) => (i + 1) * 400);
    const steps = times.map((t) => ({ t }));

    const beforeLength = stepLengthOrDefault(null);
    expect(beforeLength).toBe(0.75);
    const before = integratePath(steps, 90, { stepLength: beforeLength });

    expect(before).toHaveLength(11);
    expect(before[0]).toEqual({ x: 0, y: 0, t: 0 });
    for (let k = 1; k <= 10; k++) {
      expect(before[k]!.x).toBe(0.75 * k);
      expect(before[k]!.t).toBe(times[k - 1]);
    }
    expect(before[10]!.x).toBe(7.5);
    expect(before[10]!.y).toBeCloseTo(0, 12);
    expect(before[10]!.t).toBe(4000);

    const estimate = estimateStepLength({ distanceM: 6, stepCount: 10 });
    expect(estimate).toEqual({ stepLengthM: 0.6, distanceM: 6, stepCount: 10 });

    const afterLength = stepLengthOrDefault(estimate);
    expect(afterLength).toBe(0.6);
    const after = integratePath(steps, 90, { stepLength: afterLength });

    expect(after).toHaveLength(11);
    expect(after[0]).toEqual({ x: 0, y: 0, t: 0 });
    for (let k = 1; k <= 10; k++) {
      expect(after[k]!.x).toBeCloseTo(0.6 * k, 12);
      expect(after[k]!.y).toBeCloseTo(0, 12);
      expect(after[k]!.t).toBe(times[k - 1]);
    }
    // Ten additions of 0.6 land on this easting.
    expect(after[10]!.x).toBe(5.999999999999999);
    expect(after[10]!.t).toBe(4000);
  });

  test('10 detected steps over a measured 6 m: path goes from 7.5 m east to 6 m east', () => {
    const planted = Array.from({ length: 10 }, (_, i) => 500 + i * 500);
    const detected = detectSteps(verticalWalk(planted));
    expect(detected.map((step) => step.t)).toEqual(planted);

    const estimate = estimateStepLengthFromSteps(6, detected);
    expect(estimate).toEqual({ stepLengthM: 0.6, distanceM: 6, stepCount: 10 });

    const before = integratePath(detected, 90, { stepLength: stepLengthOrDefault(null) });
    const after = integratePath(detected, 90, { stepLength: stepLengthOrDefault(estimate) });

    expect(before[0]).toEqual({ x: 0, y: 0, t: 0 });
    expect(after[0]).toEqual({ x: 0, y: 0, t: 0 });
    expect(before[10]!.x).toBe(7.5);
    expect(before[10]!.y).toBeCloseTo(0, 12);
    expect(before[10]!.t).toBe(5000);
    expect(after[10]!.x).toBe(5.999999999999999);
    expect(after[10]!.y).toBeCloseTo(0, 12);
    expect(after[10]!.t).toBe(5000);

    for (let k = 1; k <= 10; k++) {
      expect(before[k]!.x).toBe(0.75 * k);
      expect(after[k]!.x).toBeCloseTo(0.6 * k, 12);
      expect(after[k]!.t).toBe(planted[k - 1]);
    }
  });

  test('8 detected steps over 5 m is 0.625 m/step, so 8 east steps end at x = 5', () => {
    const planted = Array.from({ length: 8 }, (_, i) => 400 + i * 400);
    const detected = detectSteps(verticalWalk(planted));
    expect(detected.map((step) => step.t)).toEqual(planted);

    const before = integratePath(detected, 90);
    const estimate = estimateStepLengthFromSteps(5, detected);
    expect(estimate).toEqual({ stepLengthM: 0.625, distanceM: 5, stepCount: 8 });
    const after = integratePath(detected, 90, { stepLength: estimate!.stepLengthM });

    expect(before[8]!.x).toBe(6);
    expect(before[8]!.y).toBeCloseTo(0, 12);
    expect(before[8]!.t).toBe(3200);
    expect(after[8]!.x).toBe(5);
    expect(after[8]!.y).toBeCloseTo(0, 12);
    expect(after[8]!.t).toBe(3200);
    for (let k = 1; k <= 8; k++) {
      expect(before[k]!.x).toBe(0.75 * k);
      expect(after[k]!.x).toBe(0.625 * k);
      expect(after[k]!.t).toBe(planted[k - 1]);
    }
  });
});

describe('getEngine', () => {
  test('still returns the static mock snapshot', () => {
    const snapshot = getEngine().getSnapshot();
    expect(snapshot.stepCount).toBe(12);
    expect(snapshot.heading).toBe(90);
    expect(snapshot.rawPath).toHaveLength(7);
    expect(snapshot.correctedPath[0]).toEqual({ x: 0, y: 0, t: 0 });
    expect(snapshot.pins.map((pin) => pin.id)).toEqual(['door', 'desk']);
    expect(typeof estimateStepLength).toBe('function');
  });
});
