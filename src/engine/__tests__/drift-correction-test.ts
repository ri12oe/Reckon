import {
  CORRIDOR_AXES_DEG,
  DEFAULT_CORRIDOR_SNAP_CONFIG,
  alignLandmarks,
  closeLoop,
  correctDrift,
  getEngine,
  mockEngine,
  nearestCorridorAxis,
  snapCorridor,
} from '@/engine';
import { integratePath } from '@/engine/path-integration';
import type { PathPoint } from '@/engine/types';

function walked(headings: readonly number[], stepLength = 1): PathPoint[] {
  return integratePath(
    headings.map((heading, index) => ({ t: (index + 1) * 500, heading })),
    0,
    { stepLength },
  );
}

function expectPoint(point: PathPoint, x: number, y: number, t: number, digits = 9): void {
  expect(point.t).toBe(t);
  expect(point.x).toBeCloseTo(x, digits);
  expect(point.y).toBeCloseTo(y, digits);
}

function clonePath(path: readonly PathPoint[]): PathPoint[] {
  return path.map((point) => ({ ...point }));
}

/** 4 steps on a wall, each heading within 8° of the wall's axis. */
const NORTH = [6, -4, 8, 2];
const EAST = [95, 87, 97, 91];
const SOUTH = [184, 174, 183, 188];
const WEST = [268, 276, 274, 265];

describe('corridor axes', () => {
  test('defaults snap within 15° of an 8-direction hall, and only a real corner splits a run', () => {
    expect(CORRIDOR_AXES_DEG).toEqual([0, 45, 90, 135, 180, 225, 270, 315]);
    expect(DEFAULT_CORRIDOR_SNAP_CONFIG).toEqual({
      snapToleranceDeg: 15,
      turnThresholdDeg: 25,
      straightToleranceDeg: 20,
      minSegments: 2,
      minStraightness: 0.85,
    });
  });

  test('nearest axis is a multiple of 45°, and an exact 22.5° tie prefers the 90° hall', () => {
    expect(nearestCorridorAxis(0)).toEqual({ axisDeg: 0, errorDeg: 0 });
    expect(nearestCorridorAxis(10)).toEqual({ axisDeg: 0, errorDeg: 10 });
    expect(nearestCorridorAxis(22.5)).toEqual({ axisDeg: 0, errorDeg: 22.5 });
    expect(nearestCorridorAxis(22.6).axisDeg).toBe(45);
    expect(nearestCorridorAxis(22.6).errorDeg).toBeCloseTo(22.4, 12);
    expect(nearestCorridorAxis(45)).toEqual({ axisDeg: 45, errorDeg: 0 });
    expect(nearestCorridorAxis(67.5)).toEqual({ axisDeg: 90, errorDeg: 22.5 });
    expect(nearestCorridorAxis(80)).toEqual({ axisDeg: 90, errorDeg: 10 });
    expect(nearestCorridorAxis(90)).toEqual({ axisDeg: 90, errorDeg: 0 });
    expect(nearestCorridorAxis(180)).toEqual({ axisDeg: 180, errorDeg: 0 });
    expect(nearestCorridorAxis(270)).toEqual({ axisDeg: 270, errorDeg: 0 });
    expect(nearestCorridorAxis(315)).toEqual({ axisDeg: 315, errorDeg: 0 });
    expect(nearestCorridorAxis(350)).toEqual({ axisDeg: 0, errorDeg: 10 });
    expect(nearestCorridorAxis(-10)).toEqual({ axisDeg: 0, errorDeg: 10 });
    expect(nearestCorridorAxis(370)).toEqual({ axisDeg: 0, errorDeg: 10 });
    expect(nearestCorridorAxis(Number.NaN)).toEqual({ axisDeg: 0, errorDeg: 180 });
  });
});

describe('snapCorridor', () => {
  test('10° snaps to 0°, 40° snaps to 45°, 80° snaps to 90°', () => {
    const north = walked([10, 10]);
    const diagonal = walked([40, 40]);
    const east = walked([80, 80]);

    expectPoint(north[2]!, 0.347296355334, 1.969615506024, 1000);
    expectPoint(diagonal[2]!, 1.285575219373, 1.532088886238, 1000);
    expectPoint(east[2]!, 1.969615506024, 0.347296355334, 1000);

    const snappedNorth = snapCorridor(north);
    const snappedDiagonal = snapCorridor(diagonal);
    const snappedEast = snapCorridor(east);

    expect(snappedNorth[2]!.x).toBe(0);
    expectPoint(snappedNorth[2]!, 0, 2, 1000);
    expectPoint(snappedDiagonal[2]!, Math.SQRT2, Math.SQRT2, 1000);
    expectPoint(snappedEast[2]!, 2, 0, 1000);

    expect(snappedNorth).not.toEqual(north);
    expect(north[2]!.y).toBeCloseTo(1.969615506024, 9);
  });

  test('20° is between the 0° and 45° halls, so the path is not moved', () => {
    const raw = walked([20, 20]);
    const corrected = snapCorridor(raw);

    expectPoint(raw[2]!, 0.684040286651, 1.879385241572, 1000);
    expect(corrected).toEqual(raw);
    expect(corrected[2]).not.toBe(raw[2]);
  });

  test('four diagonal steps at 40°–48° become a straight 45° corridor', () => {
    const raw = walked([40, 48, 43, 46], 2);
    const corrected = snapCorridor(raw);

    expectPoint(raw[4]!, 5.57454119113, 5.722374243112, 2000);
    expect(corrected).toHaveLength(5);
    for (let step = 1; step <= 4; step++) {
      expectPoint(corrected[step]!, step * Math.SQRT2, step * Math.SQRT2, step * 500);
    }
  });

  test('a 5° corridor then a 95° corridor becomes a right angle at (0, 2) and (2, 2)', () => {
    const raw = walked([5, 5, 95, 95]);
    const corrected = snapCorridor(raw);

    expectPoint(raw[2]!, 0.174311485495, 1.992389396183, 1000);
    expectPoint(raw[4]!, 2.166700881679, 1.818077910688, 2000);
    expect(corrected[2]!.x).toBe(0);
    expectPoint(corrected[2]!, 0, 2, 1000);
    expectPoint(corrected[4]!, 2, 2, 2000);
  });

  test('one step per wall is a corner, not a corridor, and due north stays on the axis', () => {
    const corners = walked([0, 90, 180, 270]);
    expect(snapCorridor(corners)).toEqual(corners);

    const north = walked([0, 0, 0]);
    expect(snapCorridor(north)).toEqual(north);
    expectPoint(north[3]!, 0, 3, 1500);
  });

  test('a known 4 m square with ±8° heading noise closes on the axes', () => {
    const raw = walked([...NORTH, ...EAST, ...SOUTH, ...WEST]);
    const before = clonePath(raw);
    const corrected = snapCorridor(raw);

    expect(raw).toEqual(before);
    expect(corrected).toHaveLength(17);

    // Integrated corners, before snap. The loop misses the origin.
    expectPoint(raw[0]!, 0, 0, 0);
    expectPoint(raw[4]!, 0.208844587186, 3.981744841389, 2000);
    expectPoint(raw[8]!, 4.19606266683, 3.807603305042, 4000);
    expectPoint(raw[12]!, 4.039325599151, -0.173380244083, 6000);
    expectPoint(raw[16]!, 0.051654128412, -0.121150546521, 8000);

    // Each wall is redrawn along 0°, 90°, 180°, 270°. Four 1 m steps a side.
    expect(corrected[4]!.x).toBe(0);
    expectPoint(corrected[4]!, 0, 4, 2000);
    expectPoint(corrected[8]!, 4, 4, 4000);
    expectPoint(corrected[12]!, 4, 0, 6000);
    expectPoint(corrected[16]!, 0, 0, 8000);
  });

  test('a tolerance of 5° leaves a 10° corridor alone; a non-finite tolerance uses 15°', () => {
    const raw = walked([10, 10]);
    expect(snapCorridor(raw, { snapToleranceDeg: 5 })).toEqual(raw);

    const snapped = snapCorridor(raw, { snapToleranceDeg: Number.NaN });
    expect(snapped[2]!.x).toBe(0);
    expectPoint(snapped[2]!, 0, 2, 1000);
  });

  test('a zigzag is not straightened once it fails the straightness check', () => {
    const raw = walked([0, 70, 0, 70]);
    const wide = {
      turnThresholdDeg: 80,
      straightToleranceDeg: 80,
      minStraightness: 0.99,
    };

    expect(snapCorridor(raw, wide)).toEqual(raw);

    const forced = snapCorridor(raw, { ...wide, minStraightness: 0 });
    expect(forced[4]!.x).toBeCloseTo(forced[4]!.y, 9);
    expect(forced).not.toEqual(raw);
  });

  test('an empty path, one point, and a non-finite sample stay as they are', () => {
    expect(snapCorridor([])).toEqual([]);
    expect(snapCorridor([{ x: 1, y: 2, t: 3 }])).toEqual([{ x: 1, y: 2, t: 3 }]);

    const broken: PathPoint[] = [
      { x: 0, y: 0, t: 0 },
      { x: 1, y: 0.05, t: 500 },
      { x: Number.NaN, y: 0, t: 1000 },
      { x: 3, y: 0.05, t: 1500 },
      { x: 4, y: 0.1, t: 2000 },
    ];
    const corrected = snapCorridor(broken);
    expect(Number.isNaN(corrected[2]!.x)).toBe(true);
    expect(corrected[3]).toEqual(broken[3]);
    expect(corrected[4]).toEqual(broken[4]);
  });
});

describe('closeLoop', () => {
  test('a 6 m by 4 m rectangle that ends at (2, 0) closes on the origin', () => {
    // North 4 m, east 6 m, south 4 m, west only 4 m. The missing 2 m is the gap.
    const raw: PathPoint[] = [
      { x: 0, y: 0, t: 0 },
      { x: 0, y: 4, t: 1000 },
      { x: 6, y: 4, t: 2000 },
      { x: 6, y: 0, t: 3000 },
      { x: 2, y: 0, t: 4000 },
    ];
    const before = clonePath(raw);
    const corrected = closeLoop(raw);

    expect(raw).toEqual(before);
    expect(corrected[0]).not.toBe(raw[0]);
    expect(corrected[0]).toEqual({ x: 0, y: 0, t: 0 });
    // Arc lengths are 4, 6, 4, 4 m (18 m). The point 4 m along the walk takes 4/18 of the (2, 0) gap.
    expect(corrected[1]!.x).toBeCloseTo(-4 / 9, 12);
    expect(corrected[1]!.y).toBe(4);
    expect(corrected[1]!.t).toBe(1000);
    expect(corrected[2]!.x).toBeCloseTo(44 / 9, 12);
    expect(corrected[2]!.y).toBe(4);
    expect(corrected[3]!.x).toBeCloseTo(40 / 9, 12);
    expect(corrected[3]!.y).toBe(0);
    expect(corrected[3]!.t).toBe(3000);
    expect(corrected[4]).toEqual({ x: 0, y: 0, t: 4000 });
  });

  test('a loop that already ends on the start is copied unchanged', () => {
    const raw: PathPoint[] = [
      { x: 0, y: 0, t: 0 },
      { x: 0, y: 4, t: 1000 },
      { x: 4, y: 4, t: 2000 },
      { x: 4, y: 0, t: 3000 },
      { x: 0, y: 0, t: 4000 },
    ];
    expect(closeLoop(raw)).toEqual(raw);
  });

  test('a custom target pulls the end there and leaves the start', () => {
    const raw: PathPoint[] = [
      { x: 0, y: 0, t: 0 },
      { x: 0, y: 4, t: 1000 },
      { x: 2, y: 4, t: 2000 },
    ];
    const corrected = closeLoop(raw, { x: 0, y: 1 });

    expect(corrected[0]).toEqual({ x: 0, y: 0, t: 0 });
    // 4 m of 6 m walked. Error is (2, 3), so this point moves by (4/3, 2).
    expect(corrected[1]!.x).toBeCloseTo(-4 / 3, 12);
    expect(corrected[1]!.y).toBeCloseTo(2, 12);
    expect(corrected[1]!.t).toBe(1000);
    expect(corrected[2]).toEqual({ x: 0, y: 1, t: 2000 });
  });

  test('no steps, one point, and a zero-length gap only move the end onto the target', () => {
    expect(closeLoop([])).toEqual([]);
    expect(closeLoop([{ x: 1, y: 2, t: 3 }])).toEqual([{ x: 1, y: 2, t: 3 }]);

    const stacked: PathPoint[] = [
      { x: 0, y: 0, t: 0 },
      { x: 0, y: 0, t: 500 },
      { x: 0, y: 0, t: 1000 },
    ];
    expect(closeLoop(stacked)).toEqual(stacked);

    const jump: PathPoint[] = [
      { x: 1, y: 1, t: 0 },
      { x: Number.NaN, y: 0, t: 500 },
      { x: 1, y: 1, t: 1000 },
    ];
    const closed = closeLoop(jump, { x: 0, y: 0 });
    expect(Number.isNaN(closed[1]!.x)).toBe(true);
    expect(closed[0]).toEqual({ x: 1, y: 1, t: 0 });
    expect(closed[2]).toEqual({ x: 0, y: 0, t: 1000 });
  });
});

describe('alignLandmarks', () => {
  test('tagging the door again pulls that visit and the tail onto the first tag', () => {
    const raw: PathPoint[] = [
      { x: 0, y: 0, t: 0 },
      { x: 5, y: 0, t: 1000 },
      { x: 5, y: 5, t: 2000 },
      { x: 0, y: 5, t: 3000 },
      { x: 0, y: 2, t: 4000 },
      { x: 3, y: 2, t: 5000 },
    ];
    const tags = [
      { id: 'door', pathIndex: 4 },
      { id: 'door', pathIndex: 0 },
    ];
    const before = clonePath(raw);
    const corrected = alignLandmarks(raw, tags);

    expect(raw).toEqual(before);
    expect(tags[0]!.pathIndex).toBe(4);
    // The earlier index is the anchor even when the tags are passed latest-first.
    // 5 m of 18 m between the tags takes 5/18 of the (0, 2) gap.
    expect(corrected[0]).toEqual({ x: 0, y: 0, t: 0 });
    expect(corrected[1]!.x).toBe(5);
    expect(corrected[1]!.y).toBeCloseTo(-5 / 9, 12);
    expect(corrected[1]!.t).toBe(1000);
    expect(corrected[2]!.x).toBe(5);
    expect(corrected[2]!.y).toBeCloseTo(35 / 9, 12);
    expect(corrected[3]!.x).toBe(0);
    expect(corrected[3]!.y).toBeCloseTo(10 / 3, 12);
    expect(corrected[4]).toEqual({ x: 0, y: 0, t: 4000 });
    expect(corrected[5]).toEqual({ x: 3, y: 0, t: 5000 });
  });

  test('a third tag of the same pin is paired with the second visit', () => {
    const raw: PathPoint[] = [
      { x: 0, y: 0, t: 0 },
      { x: 2, y: 0, t: 1 },
      { x: 2, y: 2, t: 2 },
      { x: 4, y: 2, t: 3 },
      { x: 4, y: 0, t: 4 },
    ];
    const corrected = alignLandmarks(raw, [
      { id: 'door', pathIndex: 0 },
      { id: 'door', pathIndex: 2 },
      { id: 'door', pathIndex: 4 },
    ]);

    expect(corrected[0]).toEqual({ x: 0, y: 0, t: 0 });
    expect(corrected[1]).toEqual({ x: 1, y: -1, t: 1 });
    expect(corrected[2]).toEqual({ x: 0, y: 0, t: 2 });
    expect(corrected[3]!.x).toBeCloseTo(1, 12);
    expect(corrected[3]!.y).toBeCloseTo(1, 12);
    expect(corrected[3]!.t).toBe(3);
    expect(corrected[4]).toEqual({ x: 0, y: 0, t: 4 });
  });

  test('one tag, two ids, and an index past the path do not move it', () => {
    const raw: PathPoint[] = [
      { x: 0, y: 0, t: 0 },
      { x: 1, y: 0, t: 1000 },
      { x: 1, y: 1, t: 2000 },
    ];
    expect(alignLandmarks(raw, [{ id: 'door', pathIndex: 0 }])).toEqual(raw);
    expect(
      alignLandmarks(raw, [
        { id: 'door', pathIndex: 0 },
        { id: 'desk', pathIndex: 2 },
      ]),
    ).toEqual(raw);
    expect(
      alignLandmarks(raw, [
        { id: 'door', pathIndex: 0 },
        { id: 'door', pathIndex: 9 },
        { id: 'door', pathIndex: 1.5 },
      ]),
    ).toEqual(raw);
    expect(alignLandmarks([], [])).toEqual([]);
  });
});

describe('correctDrift', () => {
  test('snap leaves the short west wall 1 m open, and loop closure then meets the start', () => {
    const raw = walked([...NORTH, ...EAST, ...SOUTH, ...WEST.slice(0, 3)]);
    const drift = correctDrift(raw, { corridor: true, closeLoop: true });

    expect(drift.raw).toEqual(raw);
    expect(drift.raw).not.toBe(raw);
    expectPoint(drift.raw[15]!, 1.047848826503, -0.033994803773, 7500);

    const snapped = snapCorridor(raw);
    expectPoint(snapped[4]!, 0, 4, 2000);
    expectPoint(snapped[8]!, 4, 4, 4000);
    expectPoint(snapped[12]!, 4, 0, 6000);
    expectPoint(snapped[15]!, 1, 0, 7500);

    expect(drift.corrected[0]).toEqual({ x: 0, y: 0, t: 0 });
    expect(drift.corrected[15]!.x).toBe(0);
    expect(drift.corrected[15]!.y).toBe(0);
    expect(drift.corrected[15]!.t).toBe(7500);
    // 4 m of the 15 m snapped walk takes 4/15 of the remaining 1 m east gap.
    expect(drift.corrected[4]!.x).toBeCloseTo(-4 / 15, 9);
    expect(drift.corrected[4]!.y).toBeCloseTo(4, 9);
    expect(drift.corrected).toEqual(closeLoop(snapped));
  });

  test('landmarks and loop closure can run without snapping an already axial path', () => {
    const raw: PathPoint[] = [
      { x: 0, y: 0, t: 0 },
      { x: 0, y: 4, t: 1000 },
      { x: 6, y: 4, t: 2000 },
      { x: 6, y: 0, t: 3000 },
      { x: 2, y: 0, t: 4000 },
    ];
    const drift = correctDrift(raw, { closeLoop: true });

    expect(drift.corrected[4]).toEqual({ x: 0, y: 0, t: 4000 });
    expect(drift.corrected[1]!.x).toBeCloseTo(-4 / 9, 12);
    expect(drift.corrected).toEqual(closeLoop(raw));
  });

  test('landmark alignment runs before loop closure', () => {
    const raw: PathPoint[] = [
      { x: 0, y: 0, t: 0 },
      { x: 5, y: 0, t: 1000 },
      { x: 5, y: 5, t: 2000 },
      { x: 0, y: 5, t: 3000 },
      { x: 0, y: 2, t: 4000 },
      { x: 3, y: 2, t: 5000 },
    ];
    const landmarks = [
      { id: 'door', pathIndex: 0 },
      { id: 'door', pathIndex: 4 },
    ];
    const drift = correctDrift(raw, { landmarks, closeLoop: true });

    expect(drift.corrected).toEqual(closeLoop(alignLandmarks(raw, landmarks)));
    expect(drift.corrected[5]).toEqual({ x: 0, y: 0, t: 5000 });
  });

  test('omitting every correction copies the path into both results', () => {
    const raw = walked([20, 20]);
    const drift = correctDrift(raw);
    expect(drift.raw).toEqual(raw);
    expect(drift.corrected).toEqual(raw);
    expect(drift.corrected).not.toBe(drift.raw);
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
    expect(mock.correctedPath[1]).toEqual({ x: 1.5, y: 0, t: 1200 });
    expect(mock.pins.map((pin) => pin.id)).toEqual(['door', 'desk']);
    expect(typeof snapCorridor).toBe('function');
    expect(typeof closeLoop).toBe('function');
    expect(typeof alignLandmarks).toBe('function');
  });
});
