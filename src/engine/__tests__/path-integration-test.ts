import { getEngine, mockEngine } from '@/engine';
import { fuseHeading, type GyroSample, type MagSample } from '@/engine/heading-fusion';
import {
  DEFAULT_PATH_INTEGRATION_CONFIG,
  DEFAULT_STEP_LENGTH_M,
  integratePath,
  stepOffset,
  type HeadingSample,
  type PathStep,
} from '@/engine/path-integration';
import { STANDARD_GRAVITY_MPS2, detectSteps, type AccelSample } from '@/engine/step-detector';
import type { PathPoint } from '@/engine/types';

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

function stepsAt(times: readonly number[], heading?: number): PathStep[] {
  return times.map((t) => (heading === undefined ? { t } : { t, heading }));
}

function expectNear(point: PathPoint, x: number, y: number, t: number): void {
  expect(point.t).toBe(t);
  expect(point.x).toBeCloseTo(x, 9);
  expect(point.y).toBeCloseTo(y, 9);
}

describe('path integration defaults', () => {
  test('step length is 0.75 m and the origin is (0, 0) at t = 0', () => {
    expect(DEFAULT_STEP_LENGTH_M).toBe(0.75);
    expect(DEFAULT_PATH_INTEGRATION_CONFIG).toEqual({
      stepLength: 0.75,
      originX: 0,
      originY: 0,
      originT: 0,
    });
  });
});

describe('stepOffset', () => {
  test('cardinals: north (0, L), east (L, 0), south (0, −L), west (−L, 0)', () => {
    const length = 0.75;
    expect(stepOffset(0, length)).toEqual({ x: 0, y: 0.75 });
    expect(stepOffset(360, length).y).toBeCloseTo(0.75, 12);
    expect(stepOffset(360, length).x).toBeCloseTo(0, 12);

    const east = stepOffset(90, length);
    expect(east.x).toBe(0.75);
    expect(east.y).toBeCloseTo(0, 12);

    const south = stepOffset(180, length);
    expect(south.x).toBeCloseTo(0, 12);
    expect(south.y).toBe(-0.75);

    const west = stepOffset(270, length);
    expect(west.x).toBe(-0.75);
    expect(west.y).toBeCloseTo(0, 12);

    expect(stepOffset(-90, length).x).toBe(-0.75);
    expect(stepOffset(450, length).x).toBe(0.75);
  });

  test('45° splits the step equally; 30° is (L/2, L·√3/2)', () => {
    const diagonal = stepOffset(45, Math.SQRT2);
    expect(diagonal.x).toBeCloseTo(1, 12);
    expect(diagonal.y).toBeCloseTo(1, 12);

    const thirty = stepOffset(30, 2);
    expect(thirty.x).toBeCloseTo(1, 12);
    expect(thirty.y).toBeCloseTo(Math.sqrt(3), 12);
  });

  test('a non-finite heading or length does not move', () => {
    expect(stepOffset(Number.NaN, 1)).toEqual({ x: 0, y: 0 });
    expect(stepOffset(90, Number.POSITIVE_INFINITY)).toEqual({ x: 0, y: 0 });
  });
});

describe('integratePath', () => {
  test('no steps is the origin only; non-finite steps are dropped', () => {
    expect(integratePath([])).toEqual([{ x: 0, y: 0, t: 0 }]);
    expect(
      integratePath(
        [
          { t: Number.NaN, heading: 90 },
          { t: Number.POSITIVE_INFINITY, heading: 90 },
        ],
        90,
        { stepLength: 1 },
      ),
    ).toEqual([{ x: 0, y: 0, t: 0 }]);
  });

  test('10 steps due east at 0.75 m: (0, 0, 0) → (7.5, 0, 4000)', () => {
    const times = Array.from({ length: 10 }, (_, i) => (i + 1) * 400);
    const path = integratePath(stepsAt(times), 90, { stepLength: 0.75 });

    expect(path).toHaveLength(11);
    expect(path[0]).toEqual({ x: 0, y: 0, t: 0 });
    for (let k = 1; k <= 10; k++) {
      expectNear(path[k]!, 0.75 * k, 0, times[k - 1]!);
    }
    expect(path[10]!.x).toBe(7.5);
    expect(path[10]!.y).toBeCloseTo(0, 12);
    expect(path[10]!.t).toBe(4000);
  });

  test('8 steps due north, south, and west at 0.5 m', () => {
    const times = Array.from({ length: 8 }, (_, i) => 1000 + i * 500);
    const north = integratePath(stepsAt(times), 0, { stepLength: 0.5 });
    const south = integratePath(stepsAt(times), 180, { stepLength: 0.5 });
    const west = integratePath(stepsAt(times), 270, { stepLength: 0.5 });

    expectNear(north[0]!, 0, 0, 0);
    expectNear(north[8]!, 0, 4, 4500);
    expect(north[8]!.y).toBe(4);

    expectNear(south[8]!, 0, -4, 4500);
    expect(south[8]!.y).toBe(-4);

    expectNear(west[8]!, -4, 0, 4500);
    expect(west[8]!.x).toBe(-4);
  });

  test('one step per wall, 1 m: corners (0, 1), (1, 1), (1, 0), back to (0, 0)', () => {
    const path = integratePath(
      [
        { t: 1000, heading: 0 },
        { t: 2000, heading: 90 },
        { t: 3000, heading: 180 },
        { t: 4000, heading: 270 },
      ],
      0,
      { stepLength: 1 },
    );

    expect(path).toHaveLength(5);
    expect(path[0]).toEqual({ x: 0, y: 0, t: 0 });
    expect(path[1]).toEqual({ x: 0, y: 1, t: 1000 });
    expect(path[2]!.x).toBe(1);
    expectNear(path[2]!, 1, 1, 2000);
    expectNear(path[3]!, 1, 0, 3000);
    expectNear(path[4]!, 0, 0, 4000);
  });

  test('4 steps × 0.75 m per wall: corners (0, 3), (3, 3), (3, 0), (0, 0)', () => {
    const side = (start: number, heading: number): PathStep[] =>
      Array.from({ length: 4 }, (_, i) => ({ t: start + i * 400, heading }));
    const steps = [...side(400, 0), ...side(2000, 90), ...side(3600, 180), ...side(5200, 270)];
    const path = integratePath(steps, 123, { stepLength: 0.75 });

    expect(path).toHaveLength(17);
    expect(path[0]).toEqual({ x: 0, y: 0, t: 0 });
    expect(path[4]!.x).toBe(0);
    expect(path[4]!.y).toBe(3);
    expectNear(path[4]!, 0, 3, 1600);
    expect(path[8]!.x).toBe(3);
    expectNear(path[8]!, 3, 3, 3200);
    expectNear(path[12]!, 3, 0, 4800);
    expectNear(path[16]!, 0, 0, 6400);
  });

  test('heading stream, held across the corner: two north then two east, 1 m', () => {
    const steps = stepsAt([500, 1000, 1500, 2000]);
    const heading: HeadingSample[] = [
      { t: 0, heading: 0 },
      { t: 1250, heading: 90 },
    ];
    const path = integratePath(steps, heading, { stepLength: 1 });

    expect(path[0]).toEqual({ x: 0, y: 0, t: 0 });
    expect(path[1]).toEqual({ x: 0, y: 1, t: 500 });
    expect(path[2]).toEqual({ x: 0, y: 2, t: 1000 });
    expect(path[3]!.x).toBe(1);
    expectNear(path[3]!, 1, 2, 1500);
    expect(path[4]!.x).toBe(2);
    expectNear(path[4]!, 2, 2, 2000);
  });

  test('a step before the first heading sample walks north; the sample at the step is used', () => {
    const path = integratePath(stepsAt([500, 1000]), [{ t: 1000, heading: 90 }], {
      stepLength: 1,
    });

    expect(path[1]).toEqual({ x: 0, y: 1, t: 500 });
    expect(path[2]!.x).toBe(1);
    expectNear(path[2]!, 1, 1, 1000);
  });

  test('a future heading does not turn the current step', () => {
    const path = integratePath(stepsAt([1000]), [{ t: 1500, heading: 90 }], { stepLength: 1 });
    expect(path[1]).toEqual({ x: 0, y: 1, t: 1000 });
  });

  test('a finite step heading overrides the constant; a non-finite one does not', () => {
    const path = integratePath(
      [
        { t: 1000, heading: 0 },
        { t: 2000, heading: Number.NaN },
        { t: 3000, heading: 90 },
      ],
      180,
      { stepLength: 1 },
    );

    expect(path[1]).toEqual({ x: 0, y: 1, t: 1000 });
    expect(path[2]!.x).toBeCloseTo(0, 12);
    expect(path[2]!.y).toBe(0);
    expectNear(path[3]!, 1, 0, 3000);
  });

  test('duplicate heading timestamps: the last sample wins', () => {
    const path = integratePath(
      stepsAt([0]),
      [
        { t: 0, heading: 0 },
        { t: 0, heading: 90 },
      ],
      { stepLength: 2 },
    );
    expect(path[1]!.x).toBe(2);
    expect(path[1]!.y).toBeCloseTo(0, 12);
  });

  test('shuffled steps and headings integrate in time order and do not mutate the inputs', () => {
    const steps: PathStep[] = [
      { t: 3000, heading: 180 },
      { t: 1000, heading: 0 },
      { t: 2000, heading: 90 },
    ];
    const heading: HeadingSample[] = [
      { t: 2000, heading: 45 },
      { t: 0, heading: 45 },
    ];
    const stepsBefore = steps.map((step) => ({ ...step }));
    const headingBefore = heading.map((sample) => ({ ...sample }));

    const path = integratePath(steps, heading, { stepLength: 1 });

    expect(steps).toEqual(stepsBefore);
    expect(heading).toEqual(headingBefore);
    expect(path[1]).toEqual({ x: 0, y: 1, t: 1000 });
    expectNear(path[2]!, 1, 1, 2000);
    expectNear(path[3]!, 1, 0, 3000);
  });

  test('equal step times keep input order', () => {
    const path = integratePath(
      [
        { t: 1000, heading: 0 },
        { t: 1000, heading: 90 },
      ],
      0,
      { stepLength: 1 },
    );
    expect(path[1]).toEqual({ x: 0, y: 1, t: 1000 });
    expectNear(path[2]!, 1, 1, 1000);
  });

  test('a custom origin is the before-point; zero length stays there', () => {
    const origin = integratePath(stepsAt([800], 0), 0, {
      stepLength: 1.5,
      originX: 5,
      originY: -2,
      originT: 250,
    });
    expect(origin[0]).toEqual({ x: 5, y: -2, t: 250 });
    expect(origin[1]).toEqual({ x: 5, y: -0.5, t: 800 });

    const parked = integratePath(stepsAt([800], 90), 90, {
      stepLength: 0,
      originX: 5,
      originY: -2,
      originT: 250,
    });
    expect(parked[1]).toEqual({ x: 5, y: -2, t: 800 });
  });

  test('a non-finite length or heading falls back to 0.75 m and 0°', () => {
    const path = integratePath(stepsAt([500]), Number.NaN, { stepLength: Number.NaN });
    expect(path[1]).toEqual({ x: 0, y: 0.75, t: 500 });
  });

  test('an empty heading stream holds north', () => {
    const path = integratePath(stepsAt([500, 1000]), [], { stepLength: 1 });
    expect(path[2]).toEqual({ x: 0, y: 2, t: 1000 });
  });

  test('detected steps plus a fused east heading: 8 × 0.7 m → x = 5.6, y ≈ 0', () => {
    const planted = Array.from({ length: 8 }, (_, i) => 500 + i * 500);
    const detected = detectSteps(verticalWalk(planted));
    const times = sampleTimes(0, 4500);
    const gyro: GyroSample[] = times.map((t) => ({ t, yawRate: 0 }));
    const mag: MagSample[] = times.map((t) => ({ t, x: 0, y: -30, z: 40 }));
    const fused = fuseHeading(gyro, mag);

    expect(detected.map((step) => step.t)).toEqual(planted);
    expect(fused.every((sample) => sample.heading === 90)).toBe(true);

    const path = integratePath(detected, fused, { stepLength: 0.7 });

    expect(path).toHaveLength(9);
    expect(path[0]).toEqual({ x: 0, y: 0, t: 0 });
    expect(path[8]!.x).toBeCloseTo(5.6, 12);
    expect(path[8]!.y).toBeCloseTo(0, 12);
    expect(path[8]!.t).toBe(4000);
    for (let k = 1; k <= 8; k++) {
      expectNear(path[k]!, 0.7 * k, 0, planted[k - 1]!);
    }
  });
});

describe('getEngine', () => {
  test('returns the live engine at the origin; mockEngine keeps the static walk', () => {
    const snapshot = getEngine().getSnapshot();
    expect(snapshot.stepCount).toBe(0);
    expect(snapshot.heading).toBe(0);
    expect(snapshot.rawPath).toEqual([{ x: 0, y: 0, t: 0 }]);
    expect(snapshot.correctedPath[0]).toEqual({ x: 0, y: 0, t: 0 });
    expect(snapshot.pins).toEqual([]);

    const mock = mockEngine.getSnapshot();
    expect(mock.stepCount).toBe(12);
    expect(mock.heading).toBe(90);
    expect(mock.rawPath).toHaveLength(7);
    expect(mock.pins.map((pin) => pin.id)).toEqual(['door', 'desk']);
    expect(typeof integratePath).toBe('function');
  });
});
