import { emptyRecording, getEngine, mockEngine } from '@/engine';
import { fuseHeading, type GyroSample, type MagSample } from '@/engine/heading-fusion';
import { createLiveEngine } from '@/engine/live-engine';
import { integratePath } from '@/engine/path-integration';
import { STANDARD_GRAVITY_MPS2, type AccelSample } from '@/engine/step-detector';
import type { EngineSnapshot, PathPoint } from '@/engine/types';

const DT_MS = 20;
const RAD = Math.PI / 180;

/** 4 steps on a wall, each heading within 8° of the wall's axis. */
const NORTH = [6, -4, 8, 2];
const EAST = [95, 87, 97, 91];
const SOUTH = [184, 174, 183, 188];
const WEST = [268, 276, 274, 265];

function sampleTimes(startMs: number, endMs: number, dt = DT_MS): number[] {
  const times: number[] = [];
  for (let t = startMs; t <= endMs; t += dt) times.push(t);
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

function northField(): { x: number; y: number; z: number } {
  return { x: 30, y: 0, z: 40 };
}

function eastField(): { x: number; y: number; z: number } {
  return { x: 0, y: -30, z: 40 };
}

/** Horizontal 30 µT, down 40 µT. Heading is degrees clockwise from magnetic north. */
function field(headingDeg: number): { x: number; y: number; z: number } {
  const heading = headingDeg * RAD;
  return { x: 30 * Math.cos(heading), y: -30 * Math.sin(heading), z: 40 };
}

function expectPoint(point: PathPoint, x: number, y: number, t: number, digits = 9): void {
  expect(point.t).toBe(t);
  expect(point.x).toBeCloseTo(x, digits);
  expect(point.y).toBeCloseTo(y, digits);
}

describe('createLiveEngine', () => {
  test('an empty engine is the origin: 0 steps, heading 0°, no pins, step length 0.75 m', () => {
    const engine = createLiveEngine();
    const snapshot = engine.getSnapshot();

    expect(engine.getStepLength()).toBe(0.75);
    expect(snapshot).toEqual({
      rawPath: [{ x: 0, y: 0, t: 0 }],
      correctedPath: [{ x: 0, y: 0, t: 0 }],
      stepCount: 0,
      heading: 0,
      pins: [],
    });
  });

  test('getSnapshot clones, and a later step does not rewrite the snapshot already returned', () => {
    const engine = createLiveEngine();
    const first = engine.getSnapshot();
    const second = engine.getSnapshot();

    expect(first).toEqual(second);
    expect(first.rawPath).not.toBe(second.rawPath);
    expect(first.rawPath[0]).not.toBe(second.rawPath[0]);

    first.rawPath[0]!.x = 99;
    first.pins.push({ id: 'nope', x: 1, y: 1, label: 'nope' });
    engine.pushStep({ t: 500, heading: 0 });

    expect(first.stepCount).toBe(0);
    expect(engine.getSnapshot().rawPath[0]).toEqual({ x: 0, y: 0, t: 0 });
    expect(engine.getSnapshot().stepCount).toBe(1);
    expect(engine.getSnapshot().rawPath[1]).toEqual({ x: 0, y: 0.75, t: 500 });
  });

  test('two engines do not share steps', () => {
    const left = createLiveEngine();
    const right = createLiveEngine();
    left.pushStep({ t: 100, heading: 90 });

    expect(left.getSnapshot().stepCount).toBe(1);
    expect(right.getSnapshot().stepCount).toBe(0);
    expect(left).not.toBe(right);
  });
});

describe('sensor walk', () => {
  test('8 detected steps facing east: (6, 0) at 0.75 m, then (5, 0) after a 5 m calibration', () => {
    const planted = Array.from({ length: 8 }, (_, i) => 400 + i * 400);
    const samples = verticalWalk(planted);
    const beforeSamples = samples.map((sample) => ({ ...sample }));
    const engine = createLiveEngine();

    for (const sample of samples.slice().reverse()) engine.pushAccel(sample);
    engine.pushMag({ t: 0, ...eastField() });

    const before = engine.getSnapshot();

    expect(samples).toEqual(beforeSamples);
    expect(before.stepCount).toBe(8);
    expect(before.heading).toBe(90);
    expect(before.rawPath).toHaveLength(9);
    expect(before.rawPath[0]).toEqual({ x: 0, y: 0, t: 0 });
    for (let k = 1; k <= 8; k++) {
      expect(before.rawPath[k]!.x).toBe(0.75 * k);
      expect(before.rawPath[k]!.y).toBeCloseTo(0, 12);
      expect(before.rawPath[k]!.t).toBe(planted[k - 1]);
    }
    expect(before.rawPath[8]!.x).toBe(6);
    expect(before.rawPath[8]!.y).toBeCloseTo(0, 12);
    expect(before.rawPath[8]!.t).toBe(3200);
    expect(before.correctedPath[8]!.x).toBeCloseTo(6, 9);
    expect(before.correctedPath[8]!.y).toBeCloseTo(0, 9);
    expect(engine.getStepLength()).toBe(0.75);

    expect(engine.calibrateStepLength(0)).toBeNull();
    expect(engine.calibrateStepLength(5, 0)).toBeNull();
    expect(engine.getStepLength()).toBe(0.75);

    expect(engine.calibrateStepLength(5)).toEqual({
      stepLengthM: 0.625,
      distanceM: 5,
      stepCount: 8,
    });

    const after = engine.getSnapshot();

    expect(after.stepCount).toBe(8);
    expect(after.heading).toBe(90);
    expect(engine.getStepLength()).toBe(0.625);
    expect(after.rawPath[0]).toEqual({ x: 0, y: 0, t: 0 });
    for (let k = 1; k <= 8; k++) {
      expect(after.rawPath[k]!.x).toBe(0.625 * k);
      expect(after.rawPath[k]!.y).toBeCloseTo(0, 12);
      expect(after.rawPath[k]!.t).toBe(planted[k - 1]);
    }
    expect(after.rawPath[8]!.x).toBe(5);
    expect(after.rawPath[8]!.y).toBeCloseTo(0, 12);
    expect(after.rawPath[8]!.t).toBe(3200);
    expect(after.correctedPath[8]!.x).toBeCloseTo(5, 9);
    expect(after.correctedPath[8]!.y).toBeCloseTo(0, 9);

    engine.reset();
    expect(engine.getStepLength()).toBe(0.75);
    expect(engine.getSnapshot()).toEqual({
      rawPath: [{ x: 0, y: 0, t: 0 }],
      correctedPath: [{ x: 0, y: 0, t: 0 }],
      stepCount: 0,
      heading: 0,
      pins: [],
    });
  });

  test('magnitude samples: 5 steps walk due north to (0, 3.75)', () => {
    const planted = [500, 1000, 1500, 2000, 2500];
    const engine = createLiveEngine();
    for (const sample of verticalWalk(planted)) {
      engine.pushAccel({ t: sample.t, magnitude: Math.hypot(sample.x, sample.y, sample.z) });
    }

    const snapshot = engine.getSnapshot();
    expect(snapshot.stepCount).toBe(5);
    expect(snapshot.heading).toBe(0);
    expect(snapshot.rawPath[5]).toEqual({ x: 0, y: 3.75, t: 2500 });
    expect(snapshot.correctedPath[5]).toEqual({ x: 0, y: 3.75, t: 2500 });
  });

  test('gravity left at 9.80665 counts 0 linear peaks; gravity 0 counts 5 and ends at y = 5', () => {
    const planted = [500, 1000, 1500, 2000, 2500];
    const samples = sampleTimes(0, 2500 + 400).map((t) => {
      let bump = 0;
      for (const center of planted) bump += hannBump(t, center, 2.5, 160);
      return { t, magnitude: bump };
    });

    const ignored = createLiveEngine({ stepLengthM: 1 });
    const counted = createLiveEngine({ stepDetector: { gravity: 0 }, stepLengthM: 1 });
    for (const sample of samples) {
      ignored.pushAccel(sample);
      counted.pushAccel(sample);
    }

    expect(ignored.getSnapshot().stepCount).toBe(0);
    expect(ignored.getSnapshot().rawPath).toEqual([{ x: 0, y: 0, t: 0 }]);

    const snapshot = counted.getSnapshot();
    expect(snapshot.stepCount).toBe(5);
    expect(snapshot.rawPath.slice(1).map((point) => point.t)).toEqual(planted);
    expect(snapshot.rawPath[5]).toEqual({ x: 0, y: 5, t: 2500 });
  });

  test('a stable 80° compass reacquires and the walk leaves the north line', () => {
    const planted = [500, 1000, 1500, 2000, 2500, 3000, 3500, 4000];
    const times = sampleTimes(0, 4000);
    const engine = createLiveEngine({ stepLengthM: 1 });

    for (const sample of verticalWalk(planted)) engine.pushAccel(sample);
    for (const t of times) {
      engine.pushGyro({ t, yawRate: 0 });
      const axes = t >= 1000 && t <= 3000 ? field(80) : northField();
      engine.pushMag({ t, ...axes });
    }

    const naive = integratePath(
      planted.map((t) => ({ t })),
      planted.map((t) => ({ t, heading: t >= 1000 && t <= 3000 ? 80 : 0 })),
      { stepLength: 1 },
    );
    const trusted = fuseHeading(
      times.map((t): GyroSample => ({ t, yawRate: 0 })),
      times.map((t): MagSample => ({ t, ...(t >= 1000 && t <= 3000 ? field(80) : northField()) })),
      { jumpThresholdDeg: 180, reacquireMaxDeg: 180 },
    );
    const trustedAt3000 = trusted.find((sample) => sample.t === 3000);
    const tau = 1.5;
    const caught = 80 * (1 - Math.exp(-(3000 - 980) / 1000 / tau));
    const headingAt = (t: number) => {
      if (t < 1400) return 0;
      if (t <= 3000) return 80 * (1 - Math.exp(-(t - 980) / 1000 / tau));
      if (t < 3420) return caught;
      return caught * Math.exp(-(t - 3000) / 1000 / tau);
    };
    const blended = integratePath(
      planted.map((t) => ({ t, heading: headingAt(t) })),
      0,
      { stepLength: 1 },
    );

    expect(times).toHaveLength(201);
    expect(naive).toHaveLength(9);
    expect(naive[8]!.x).toBeCloseTo(4.924038765061, 9);
    expect(naive[8]!.y).toBeCloseTo(3.868240888335, 9);
    expect(naive[8]!.t).toBe(4000);
    expect(trustedAt3000?.heading).toBeCloseTo(59.1915, 3);
    expect(headingAt(4000)).toBeCloseTo(30.3899, 4);

    const snapshot = engine.getSnapshot();
    expect(snapshot.stepCount).toBe(8);
    expect(snapshot.heading).toBeCloseTo(30.3899, 4);
    expect(snapshot.gyroOnly).toBe(false);
    expect(snapshot.heading).toBeCloseTo(headingAt(4000), 6);
    expect(snapshot.rawPath.slice(1).map((point) => point.t)).toEqual(planted);
    expect(snapshot.rawPath[8]!.x).toBeCloseTo(blended[8]!.x, 4);
    expect(snapshot.rawPath[8]!.y).toBeCloseTo(blended[8]!.y, 4);
    expect(snapshot.rawPath[8]!.t).toBe(4000);
    expect(snapshot.correctedPath[8]!.x).toBeCloseTo(blended[8]!.x, 4);
    expect(snapshot.correctedPath[8]!.y).toBeCloseTo(blended[8]!.y, 4);
    expect(snapshot.rawPath[8]).not.toEqual({ x: 0, y: 8, t: 4000 });
    expect(snapshot.rawPath[8]).not.toEqual(naive[8]);
  });

  test('four steps north, 90°/s for one second, four steps east: (0, 4) then (4, 4), heading 90°', () => {
    const engine = createLiveEngine({ stepLengthM: 1 });
    engine.pushMag({ t: 0, ...northField() });
    engine.pushGyro({ t: 0, yawRate: 0 });
    engine.pushGyro({ t: 2000, yawRate: 90 * RAD });
    engine.pushGyro({ t: 3000, yawRate: 0 });
    for (const t of [500, 1000, 1500, 2000, 3500, 4000, 4500, 5000]) engine.pushStep({ t });

    const snapshot = engine.getSnapshot();
    expect(snapshot.stepCount).toBe(8);
    expect(snapshot.heading).toBe(90);
    expect(snapshot.rawPath[0]).toEqual({ x: 0, y: 0, t: 0 });
    expect(snapshot.rawPath[4]).toEqual({ x: 0, y: 4, t: 2000 });
    expect(snapshot.rawPath[8]).toEqual({ x: 4, y: 4, t: 5000 });
    expect(snapshot.correctedPath[4]).toEqual({ x: 0, y: 4, t: 2000 });
    expect(snapshot.correctedPath[8]).toEqual({ x: 4, y: 4, t: 5000 });
  });
});

describe('precomputed steps and headings', () => {
  test('a heading stream holds across the corner: (0, 2) then (2, 2)', () => {
    const engine = createLiveEngine({ stepLengthM: 1 });
    engine.pushHeading({ t: 0, heading: 0 });
    engine.pushHeading({ t: 1250, heading: 90 });
    for (const t of [500, 1000, 1500, 2000]) engine.pushStep({ t });

    const snapshot = engine.getSnapshot();
    expect(snapshot.stepCount).toBe(4);
    expect(snapshot.heading).toBe(90);
    expect(snapshot.gyroOnly).toBeUndefined();
    expect(snapshot.rawPath[1]).toEqual({ x: 0, y: 1, t: 500 });
    expect(snapshot.rawPath[2]).toEqual({ x: 0, y: 2, t: 1000 });
    expect(snapshot.rawPath[3]!.x).toBe(1);
    expect(snapshot.rawPath[3]!.y).toBeCloseTo(2, 12);
    expect(snapshot.rawPath[3]!.t).toBe(1500);
    expect(snapshot.rawPath[4]!.x).toBe(2);
    expect(snapshot.rawPath[4]!.y).toBeCloseTo(2, 12);
    expect(snapshot.rawPath[4]!.t).toBe(2000);
  });

  test('shuffled steps sort by time: north then east ends at (1, 1)', () => {
    const engine = createLiveEngine({ stepLengthM: 1, drift: { corridor: false } });
    engine.pushStep({ t: 2000, heading: 90 });
    engine.pushStep({ t: 1000, heading: 0 });

    const snapshot = engine.getSnapshot();
    expect(snapshot.heading).toBe(90);
    expect(snapshot.rawPath[1]).toEqual({ x: 0, y: 1, t: 1000 });
    expect(snapshot.rawPath[2]!.x).toBe(1);
    expect(snapshot.rawPath[2]!.y).toBeCloseTo(1, 12);
    expect(snapshot.rawPath[2]!.t).toBe(2000);
  });

  test('three explicit steps replace eight accelerometer peaks: 8 → 3, end (0, 2.25)', () => {
    const planted = Array.from({ length: 8 }, (_, i) => 400 + i * 400);
    const engine = createLiveEngine();
    for (const sample of verticalWalk(planted)) engine.pushAccel(sample);
    expect(engine.getSnapshot().stepCount).toBe(8);
    expect(engine.getSnapshot().rawPath[8]!.y).toBeCloseTo(6, 12);

    for (const t of [100, 200, 300]) engine.pushStep({ t, heading: 0 });
    const snapshot = engine.getSnapshot();
    expect(snapshot.stepCount).toBe(3);
    expect(snapshot.heading).toBe(0);
    expect(snapshot.rawPath).toEqual([
      { x: 0, y: 0, t: 0 },
      { x: 0, y: 0.75, t: 100 },
      { x: 0, y: 1.5, t: 200 },
      { x: 0, y: 2.25, t: 300 },
    ]);
  });

  test('a step heading displaces that step; the fused course stays 90°', () => {
    const engine = createLiveEngine({ stepLengthM: 1, drift: { corridor: false } });
    engine.pushMag({ t: 0, ...eastField() });
    engine.pushStep({ t: 1000, heading: 0 });

    const snapshot = engine.getSnapshot();
    expect(snapshot.heading).toBe(90);
    expect(snapshot.gyroOnly).toBe(false);
    expect(snapshot.stepCount).toBe(1);
    expect(snapshot.rawPath[1]).toEqual({ x: 0, y: 1, t: 1000 });
  });

  test('gyro-only propagation uses the configured initial heading of 90°', () => {
    const engine = createLiveEngine({
      stepLengthM: 1,
      headingFusion: { initialHeadingDeg: 90 },
      drift: { corridor: false },
    });
    engine.pushGyro({ t: 0, yawRate: 0 });
    engine.pushStep({ t: 500 });

    const snapshot = engine.getSnapshot();
    expect(snapshot.heading).toBe(90);
    expect(snapshot.gyroOnly).toBe(true);
    expect(snapshot.rawPath[0]).toEqual({ x: 0, y: 0, t: 0 });
    expect(snapshot.rawPath[1]!.x).toBe(1);
    expect(snapshot.rawPath[1]!.y).toBeCloseTo(0, 12);
    expect(snapshot.rawPath[1]!.t).toBe(500);
  });

  test('a configured origin (10, −2) at t = 50, then one step north', () => {
    const engine = createLiveEngine({
      originX: 10,
      originY: -2,
      originT: 50,
      stepLengthM: 1,
    });
    engine.pushStep({ t: 100, heading: 0 });

    const snapshot = engine.getSnapshot();
    expect(snapshot.heading).toBe(0);
    expect(snapshot.rawPath).toEqual([
      { x: 10, y: -2, t: 50 },
      { x: 10, y: -1, t: 100 },
    ]);
  });

  test('setStepLength ignores NaN and otherwise replaces 0.75', () => {
    const engine = createLiveEngine();
    engine.setStepLength(Number.NaN);
    expect(engine.getStepLength()).toBe(0.75);
    engine.setStepLength(0.5);
    engine.pushStep({ t: 1000, heading: 0 });
    expect(engine.getStepLength()).toBe(0.5);
    expect(engine.getSnapshot().rawPath[1]).toEqual({ x: 0, y: 0.5, t: 1000 });
  });
});

describe('drift correction on the live path', () => {
  test('four 10° steps: raw ends at (0.695, 3.939); snap and the pin land on (0, 4)', () => {
    const engine = createLiveEngine({ stepLengthM: 1, drift: { corridor: false } });
    for (const [index, heading] of [10, 10, 10, 10].entries()) {
      engine.pushStep({ t: (index + 1) * 500, heading });
    }
    engine.tagLandmark({ id: 'end', pathIndex: 4, label: 'end of hall' });

    const before = engine.getSnapshot();
    expect(before.stepCount).toBe(4);
    expect(before.heading).toBe(10);
    expectPoint(before.rawPath[2]!, 0.347296355334, 1.969615506024, 1000);
    expectPoint(before.rawPath[4]!, 0.694592710668, 3.939231012049, 2000);
    expect(before.correctedPath).toEqual(before.rawPath);
    expect(before.pins[0]!.x).toBeCloseTo(0.694592710668, 9);
    expect(before.pins[0]!.y).toBeCloseTo(3.939231012049, 9);
    expect(before.pins[0]).toMatchObject({ id: 'end', label: 'end of hall' });

    engine.setDrift({ corridor: true });
    const after = engine.getSnapshot();

    expectPoint(after.rawPath[4]!, 0.694592710668, 3.939231012049, 2000);
    expect(after.correctedPath[4]!.x).toBe(0);
    expect(after.correctedPath[4]!.y).toBeCloseTo(4, 9);
    expect(after.correctedPath[4]!.t).toBe(2000);
    expect(after.pins).toHaveLength(1);
    expect(after.pins[0]!.id).toBe('end');
    expect(after.pins[0]!.label).toBe('end of hall');
    expect(after.pins[0]!.x).toBe(0);
    expect(after.pins[0]!.y).toBeCloseTo(4, 9);
    expect(after.stepCount).toBe(4);
    expect(after.heading).toBe(10);
  });

  test('2 steps at 5° then 2 at 95°: raw ends at (2.167, 1.818); the snap is the corner (2, 2)', () => {
    const engine = createLiveEngine({ stepLengthM: 1 });
    for (const [index, heading] of [5, 5, 95, 95].entries()) {
      engine.pushStep({ t: (index + 1) * 500, heading });
    }

    const snapshot = engine.getSnapshot();
    expect(snapshot.stepCount).toBe(4);
    expect(snapshot.heading).toBe(95);
    expectPoint(snapshot.rawPath[2]!, 0.174311485495, 1.992389396183, 1000);
    expectPoint(snapshot.rawPath[4]!, 2.166700881679, 1.818077910688, 2000);
    expect(snapshot.correctedPath[2]!.x).toBe(0);
    expectPoint(snapshot.correctedPath[2]!, 0, 2, 1000);
    expectPoint(snapshot.correctedPath[4]!, 2, 2, 2000);
  });

  test('a noisy 4 m square ends at (0.052, −0.121) raw and (0, 0) corrected', () => {
    const headings = [...NORTH, ...EAST, ...SOUTH, ...WEST];
    const engine = createLiveEngine({ stepLengthM: 1 });
    for (const [index, heading] of headings.entries()) {
      engine.pushStep({ t: (index + 1) * 500, heading });
    }

    const snapshot = engine.getSnapshot();
    expect(snapshot.stepCount).toBe(16);
    expect(snapshot.heading).toBe(265);
    expect(snapshot.rawPath).toHaveLength(17);
    expect(snapshot.correctedPath).toHaveLength(17);

    expectPoint(snapshot.rawPath[0]!, 0, 0, 0);
    expectPoint(snapshot.rawPath[4]!, 0.208844587186, 3.981744841389, 2000);
    expectPoint(snapshot.rawPath[8]!, 4.19606266683, 3.807603305042, 4000);
    expectPoint(snapshot.rawPath[12]!, 4.039325599151, -0.173380244083, 6000);
    expectPoint(snapshot.rawPath[16]!, 0.051654128412, -0.121150546521, 8000);

    expect(snapshot.correctedPath[4]!.x).toBe(0);
    expectPoint(snapshot.correctedPath[4]!, 0, 4, 2000);
    expectPoint(snapshot.correctedPath[8]!, 4, 4, 4000);
    expectPoint(snapshot.correctedPath[12]!, 4, 0, 6000);
    expectPoint(snapshot.correctedPath[16]!, 0, 0, 8000);
  });

  test('an open 6 m by 4 m loop ends at (2, 0); closure pulls that end to (0, 0)', () => {
    const headings = [
      ...Array<number>(4).fill(0),
      ...Array<number>(6).fill(90),
      ...Array<number>(4).fill(180),
      ...Array<number>(4).fill(270),
    ];
    const engine = createLiveEngine({ stepLengthM: 1 });
    for (const [index, heading] of headings.entries()) {
      engine.pushStep({ t: (index + 1) * 1000, heading });
    }

    const before = engine.getSnapshot();
    expect(before.stepCount).toBe(18);
    expect(before.heading).toBe(270);
    expect(before.rawPath[4]).toEqual({ x: 0, y: 4, t: 4000 });
    expect(before.rawPath[10]).toEqual({ x: 6, y: 4, t: 10000 });
    expect(before.rawPath[14]).toEqual({ x: 6, y: 0, t: 14000 });
    expect(before.rawPath[18]!.x).toBe(2);
    expect(before.rawPath[18]!.y).toBeCloseTo(0, 12);
    expect(before.rawPath[18]!.t).toBe(18000);
    expect(before.correctedPath[18]!.x).toBeCloseTo(2, 9);
    expect(before.correctedPath[18]!.y).toBeCloseTo(0, 9);

    engine.setDrift({ closeLoop: true });
    const after = engine.getSnapshot();

    expect(after.rawPath[18]!.x).toBe(2);
    expect(after.rawPath[18]!.t).toBe(18000);
    expect(after.correctedPath[0]).toEqual({ x: 0, y: 0, t: 0 });
    expect(after.correctedPath[4]!.x).toBeCloseTo(-4 / 9, 9);
    expect(after.correctedPath[4]!.y).toBeCloseTo(4, 9);
    expect(after.correctedPath[4]!.t).toBe(4000);
    expect(after.correctedPath[18]).toEqual({ x: 0, y: 0, t: 18000 });
    expect(after.stepCount).toBe(18);
    expect(after.heading).toBe(270);
  });

  test('a landmark with no index sits on the current end: two north steps, pin at (0, 2)', () => {
    const engine = createLiveEngine({ stepLengthM: 1, drift: { corridor: false } });
    engine.pushStep({ t: 500, heading: 0 });
    engine.pushStep({ t: 1000, heading: 0 });
    engine.tagLandmark({ id: 'here', label: 'here' });

    const snapshot = engine.getSnapshot();
    expect(snapshot.stepCount).toBe(2);
    expect(snapshot.rawPath[2]).toEqual({ x: 0, y: 2, t: 1000 });
    expect(snapshot.pins).toEqual([{ id: 'here', x: 0, y: 2, label: 'here' }]);

    engine.pushStep({ t: 1500, heading: 0 });
    const later = engine.getSnapshot();
    expect(later.rawPath[3]).toEqual({ x: 0, y: 3, t: 1500 });
    expect(later.pins).toEqual([{ id: 'here', x: 0, y: 2, label: 'here' }]);
  });

  test('tagging the door again pulls the end from (4, 0) to (0, 0); the desk pin stays put', () => {
    const engine = createLiveEngine({ stepLengthM: 1 });
    for (let index = 0; index < 4; index++) {
      engine.pushStep({ t: (index + 1) * 500, heading: 90 });
    }
    engine.tagLandmark({ id: 'door', pathIndex: 0, label: 'door' });
    engine.tagLandmark({ id: 'door', pathIndex: 4 });
    engine.addPin({ id: 'desk', x: 1.5, y: 2.5, label: 'desk' });

    const closed = engine.getSnapshot();
    expect(closed.stepCount).toBe(4);
    expect(closed.heading).toBe(90);
    expect(closed.rawPath[4]!.x).toBe(4);
    expect(closed.rawPath[4]!.y).toBeCloseTo(0, 12);
    expect(closed.rawPath[4]!.t).toBe(2000);
    expect(closed.correctedPath[4]).toEqual({ x: 0, y: 0, t: 2000 });
    expect(closed.pins).toEqual([
      { id: 'door', x: 0, y: 0, label: 'door' },
      { id: 'desk', x: 1.5, y: 2.5, label: 'desk' },
    ]);

    engine.setDrift({ landmarks: [] });
    const opened = engine.getSnapshot();
    expect(opened.pins).toEqual([{ id: 'desk', x: 1.5, y: 2.5, label: 'desk' }]);
    expect(opened.correctedPath[4]!.x).toBeCloseTo(4, 9);
    expect(opened.correctedPath[4]!.y).toBeCloseTo(0, 9);
    expect(opened.rawPath[4]!.x).toBe(4);
  });

  test('recallSnapshot shows a saved walk until clearRecall or reset', () => {
    const demo: EngineSnapshot = {
      rawPath: [{ x: 1, y: 1, t: 1 }],
      correctedPath: [{ x: 1, y: 1, t: 1 }],
      stepCount: 9,
      heading: 10,
      pins: [],
    };
    const engine = createLiveEngine({ emptySnapshot: demo });
    expect(engine.getSnapshot()).toEqual(demo);
    expect(engine.isRecalled()).toBe(false);

    const saved: EngineSnapshot = {
      rawPath: [{ x: 0, y: 0, t: 0 }],
      correctedPath: [{ x: 4, y: 0, t: 10 }],
      stepCount: 2,
      heading: 45,
      pins: [{ id: 'pin', x: 4, y: 0, label: 'pin' }],
    };
    engine.recallSnapshot(saved);
    saved.pins[0]!.label = 'changed';

    const shown = engine.getSnapshot();
    expect(engine.isRecalled()).toBe(true);
    expect(shown.stepCount).toBe(2);
    expect(shown.heading).toBe(45);
    expect(shown.pins).toEqual([{ id: 'pin', x: 4, y: 0, label: 'pin' }]);
    expect(shown.correctedPath).not.toBe(saved.correctedPath);

    engine.pushStep({ t: 500, heading: 0 });
    expect(engine.getSnapshot().stepCount).toBe(2);

    engine.clearRecall();
    expect(engine.isRecalled()).toBe(false);
    expect(engine.getSnapshot().stepCount).toBe(1);

    engine.recallSnapshot(saved);
    engine.reset();
    expect(engine.isRecalled()).toBe(false);
    expect(engine.getSnapshot()).toEqual(demo);
  });

  test('snapshotForSave is empty during the demo and follows a real walk', () => {
    const demo = mockEngine.getSnapshot();
    const engine = createLiveEngine({ emptySnapshot: demo });
    expect(engine.getSnapshot().stepCount).toBe(12);
    expect(engine.getSnapshot().correctedPath).toHaveLength(7);
    expect(engine.snapshotForSave()).toEqual(emptyRecording());
    expect(engine.sensorsActive()).toBe(false);

    engine.pushAccel({ t: 0, x: 0, y: 0, z: 9.8 });
    const live = engine.getSnapshot();
    expect(live).not.toEqual(demo);
    expect(engine.snapshotForSave()).toEqual(live);

    const saved: EngineSnapshot = {
      rawPath: [
        { x: 0, y: 0, t: 0 },
        { x: 1, y: 0, t: 500 },
      ],
      correctedPath: [
        { x: 0, y: 0, t: 0 },
        { x: 1, y: 0, t: 500 },
      ],
      stepCount: 1,
      heading: 90,
      pins: [],
    };
    engine.recallSnapshot(saved);
    expect(engine.snapshotForSave().stepCount).toBe(1);
    expect(engine.snapshotForSave().correctedPath).toHaveLength(2);

    engine.recallSnapshot(demo);
    expect(engine.getSnapshot()).toEqual(demo);
    expect(engine.snapshotForSave()).toEqual(emptyRecording());
  });
});

describe('getEngine', () => {
  test('returns one live engine and serves the demo until the first sample', () => {
    expect(getEngine()).toBe(getEngine());
    expect(getEngine()).not.toBe(mockEngine);
    expect(getEngine()).not.toBe(createLiveEngine());
    expect(typeof getEngine().startSensors).toBe('function');
    expect(typeof getEngine().stopSensors).toBe('function');

    const snapshot = getEngine().getSnapshot();
    expect(snapshot).toEqual(mockEngine.getSnapshot());
    expect(snapshot).not.toBe(mockEngine.getSnapshot());
    expect(snapshot.stepCount).toBe(12);
    expect(snapshot.heading).toBe(90);

    const mock = mockEngine.getSnapshot();
    expect(mock.stepCount).toBe(12);
    expect(mock.heading).toBe(90);
    expect(mock.rawPath).toHaveLength(7);
    expect(mock.correctedPath).toHaveLength(7);
    expect(mock.correctedPath[1]).toEqual({ x: 1.5, y: 0, t: 1200 });
    expect(mock.pins).toEqual([
      { id: 'door', x: 4.5, y: 1.5, label: 'door' },
      { id: 'desk', x: 4.5, y: 4.5, label: 'desk' },
    ]);
  });
});
