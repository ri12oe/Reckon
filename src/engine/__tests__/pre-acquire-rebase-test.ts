import { fuseHeading } from '@/engine/heading-fusion';
import { createLiveEngine } from '@/engine/live-engine';
import { integratePath } from '@/engine/path-integration';
import type { PathPoint } from '@/engine/types';

const DT_MS = 20;
const RAD = Math.PI / 180;

function sampleTimes(startMs: number, endMs: number, dt = DT_MS): number[] {
  const times: number[] = [];
  for (let t = startMs; t <= endMs; t += dt) times.push(t);
  return times;
}

/** East field: heading 90°, |B| = 50 µT. */
function eastField(): { x: number; y: number; z: number } {
  return { x: 0, y: -30, z: 40 };
}

function point(path: PathPoint): { x: number; y: number; t: number } {
  return {
    x: Math.round(path.x * 1e6) / 1e6,
    y: Math.round(path.y * 1e6) / 1e6,
    t: path.t,
  };
}

/**
 * Straight 1 m steps while the compass reads east and the gyro is still.
 * Steps at 100, 200, and 300 ms are before the 400 ms acquire.
 * The step at 800 ms is after it.
 */
describe('steps before the first magnetometer acquire', () => {
  test('facing east: the open path is north, and acquire rotates that prefix onto east', () => {
    const engine = createLiveEngine({ stepLengthM: 1, drift: { corridor: false } });
    for (const t of [100, 200, 300]) engine.pushStep({ t });
    for (const t of sampleTimes(0, 200)) {
      engine.pushGyro({ t, yawRate: 0 });
      engine.pushMag({ t, ...eastField() });
    }

    const before = engine.getSnapshot();
    expect(before.gyroOnly).toBe(true);
    expect(before.heading).toBeCloseTo(0, 5);
    expect(before.rawPath.map(point)).toEqual([
      { x: 0, y: 0, t: 0 },
      { x: 0, y: 1, t: 100 },
      { x: 0, y: 2, t: 200 },
      { x: 0, y: 3, t: 300 },
    ]);

    for (const t of sampleTimes(220, 1000)) {
      engine.pushGyro({ t, yawRate: 0 });
      engine.pushMag({ t, ...eastField() });
    }
    engine.pushStep({ t: 800 });

    const after = engine.getSnapshot();
    expect(after.gyroOnly).toBe(false);
    expect(after.heading).toBeCloseTo(90, 5);
    expect(after.stepCount).toBe(4);
    expect(after.rawPath.map(point)).toEqual([
      { x: 0, y: 0, t: 0 },
      { x: 1, y: 0, t: 100 },
      { x: 2, y: 0, t: 200 },
      { x: 3, y: 0, t: 300 },
      { x: 4, y: 0, t: 800 },
    ]);
    expect(after.correctedPath.map(point)).toEqual(after.rawPath.map(point));
  });

  test('a 90°/s gyro turn before any compass fix is the provisional course, not north', () => {
    const engine = createLiveEngine({ stepLengthM: 1, drift: { corridor: false } });
    const times = sampleTimes(0, 1000);
    for (const t of times) engine.pushGyro({ t, yawRate: 90 * RAD });
    engine.pushStep({ t: 500 });
    engine.pushStep({ t: 1000 });

    const fused = fuseHeading(
      times.map((t) => ({ t, yawRate: 90 * RAD })),
      [],
    );
    const at = (t: number) => fused.find((sample) => sample.t === t);

    const snapshot = engine.getSnapshot();
    expect(snapshot.gyroOnly).toBe(true);
    expect(at(500)?.heading).toBeCloseTo(45, 6);
    expect(at(1000)?.heading).toBeCloseTo(90, 6);
    expect(snapshot.heading).toBeCloseTo(90, 5);
    expect(snapshot.rawPath[1]!.t).toBe(500);
    expect(snapshot.rawPath[1]!.x).toBeCloseTo(Math.sin(Math.PI / 4), 6);
    expect(snapshot.rawPath[1]!.y).toBeCloseTo(Math.cos(Math.PI / 4), 6);
    expect(snapshot.rawPath[2]!.t).toBe(1000);
    expect(snapshot.rawPath[2]!.x).toBeCloseTo(Math.sin(Math.PI / 4) + 1, 6);
    expect(snapshot.rawPath[2]!.y).toBeCloseTo(Math.cos(Math.PI / 4), 6);
  });

  test('a walk long enough to bake steps still rotates the pre-acquire prefix onto east', () => {
    const engine = createLiveEngine({ stepLengthM: 1, drift: { corridor: false } });
    for (const t of [100, 200, 300, 1500]) engine.pushStep({ t });
    for (const t of sampleTimes(0, 2000)) {
      engine.pushGyro({ t, yawRate: 0 });
      engine.pushMag({ t, ...eastField() });
    }

    const after = engine.getSnapshot();
    expect(after.gyroOnly).toBe(false);
    expect(after.heading).toBeCloseTo(90, 5);
    expect(after.rawPath.map(point)).toEqual([
      { x: 0, y: 0, t: 0 },
      { x: 1, y: 0, t: 100 },
      { x: 2, y: 0, t: 200 },
      { x: 3, y: 0, t: 300 },
      { x: 4, y: 0, t: 1500 },
    ]);
  });

  test('steps baked on the gyro course rotate when the compass later locks east', () => {
    const engine = createLiveEngine({ stepLengthM: 1, drift: { corridor: false } });
    for (const t of [100, 200, 300]) engine.pushStep({ t });
    for (const t of sampleTimes(0, 4000)) engine.pushGyro({ t, yawRate: 0 });

    const before = engine.getSnapshot();
    expect(before.gyroOnly).toBe(true);
    expect(before.rawPath.map(point)).toEqual([
      { x: 0, y: 0, t: 0 },
      { x: 0, y: 1, t: 100 },
      { x: 0, y: 2, t: 200 },
      { x: 0, y: 3, t: 300 },
    ]);

    for (const t of sampleTimes(4020, 5000)) {
      engine.pushGyro({ t, yawRate: 0 });
      engine.pushMag({ t, ...eastField() });
    }

    const after = engine.getSnapshot();
    expect(after.gyroOnly).toBe(false);
    expect(after.heading).toBeCloseTo(90, 5);
    expect(after.rawPath.map(point)).toEqual([
      { x: 0, y: 0, t: 0 },
      { x: 1, y: 0, t: 100 },
      { x: 2, y: 0, t: 200 },
      { x: 3, y: 0, t: 300 },
    ]);
  });

  test('a step that already has a heading stays put while the open prefix rotates', () => {
    const engine = createLiveEngine({ stepLengthM: 1, drift: { corridor: false } });
    engine.pushStep({ t: 100, heading: 0 });
    engine.pushStep({ t: 200 });
    for (const t of sampleTimes(0, 1000)) {
      engine.pushGyro({ t, yawRate: 0 });
      engine.pushMag({ t, ...eastField() });
    }

    const path = engine.getSnapshot().rawPath;
    expect(path[1]).toEqual({ x: 0, y: 1, t: 100 });
    expect(path[2]!.t).toBe(200);
    expect(path[2]!.x).toBeCloseTo(1, 6);
    expect(path[2]!.y).toBeCloseTo(1, 6);
  });
});

describe('integratePath and the first trusted heading', () => {
  test('a turned gyro prefix rotates onto the acquire jump, and a later hold does not', () => {
    const samples = [
      { t: 0, heading: 0, gyroOnly: true },
      { t: 200, heading: 18, gyroOnly: true },
      { t: 380, heading: 34.2, gyroOnly: true },
      { t: 400, heading: 180, gyroOnly: false },
      { t: 1000, heading: 10, gyroOnly: true },
    ];
    const path = integratePath([{ t: 200 }, { t: 1000 }], samples, { stepLength: 1 });
    const turned = (18 + (180 - 34.2)) * RAD;
    const held = 10 * RAD;

    expect(path).toHaveLength(3);
    expect(path[1]!.t).toBe(200);
    expect(path[1]!.x).toBeCloseTo(Math.sin(turned), 6);
    expect(path[1]!.y).toBeCloseTo(Math.cos(turned), 6);
    expect(path[2]!.t).toBe(1000);
    expect(path[2]!.x).toBeCloseTo(Math.sin(turned) + Math.sin(held), 6);
    expect(path[2]!.y).toBeCloseTo(Math.cos(turned) + Math.cos(held), 6);
  });

  test('a step heading is not rotated with the prefix', () => {
    const path = integratePath(
      [{ t: 100, heading: 0 }, { t: 200 }],
      [
        { t: 0, heading: 0, gyroOnly: true },
        { t: 400, heading: 90, gyroOnly: false },
      ],
      { stepLength: 1 },
    );

    expect(path[1]).toEqual({ x: 0, y: 1, t: 100 });
    expect(path[2]!.x).toBeCloseTo(1, 6);
    expect(path[2]!.y).toBeCloseTo(1, 6);
  });
});
