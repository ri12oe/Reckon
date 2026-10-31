import type { EngineSnapshot } from '@/engine';
import {
  MAX_MAP_SCALE,
  MIN_MAP_SCALE,
  canvasToStage,
  clampTranslation,
  framePoints,
  hitTestPin,
  makeProjector,
  panBaseline,
  panTo,
  pathForMode,
  pathToSvg,
  pinchAboutFocal,
  pinchBaseline,
  stageToCanvas,
} from '@/map/geometry';

const snapshot: EngineSnapshot = {
  rawPath: [
    { x: 0, y: 0, t: 0 },
    { x: 2, y: 1, t: 1 },
  ],
  correctedPath: [
    { x: 0, y: 0, t: 0 },
    { x: 2, y: 0, t: 1 },
  ],
  stepCount: 1,
  heading: 90,
  pins: [{ id: 'door', x: 2, y: 0, label: 'door' }],
};

describe('path mode', () => {
  test('raw and corrected stay separate paths', () => {
    expect(pathForMode(snapshot, 'raw')).toBe(snapshot.rawPath);
    expect(pathForMode(snapshot, 'corrected')).toBe(snapshot.correctedPath);
  });

  test('the fit frame includes both paths and the pins', () => {
    expect(framePoints(snapshot)).toEqual([
      ...snapshot.rawPath,
      ...snapshot.correctedPath,
      ...snapshot.pins,
    ]);
  });
});

describe('makeProjector', () => {
  test('north is up and the walk sits inside the padding', () => {
    const place = makeProjector(framePoints(snapshot), 200, 200, 24);
    expect(place).not.toBeNull();
    if (!place) return;

    const origin = place({ x: 0, y: 0 });
    const north = place({ x: 0, y: 1 });
    const east = place({ x: 2, y: 0 });
    expect(north.y).toBeLessThan(origin.y);
    expect(east.x).toBeGreaterThan(origin.x);
    for (const point of [origin, north, east]) {
      expect(point.x).toBeGreaterThanOrEqual(24);
      expect(point.x).toBeLessThanOrEqual(176);
      expect(point.y).toBeGreaterThanOrEqual(24);
      expect(point.y).toBeLessThanOrEqual(176);
    }
  });

  test('a line of fitted points is an svg path', () => {
    const place = makeProjector(
      [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
      ],
      100,
      100,
      10,
    );
    expect(place).not.toBeNull();
    if (!place) return;
    const path = pathToSvg([place({ x: 0, y: 0 }), place({ x: 1, y: 0 })]);
    expect(path.startsWith('M ')).toBe(true);
    expect(path).toContain(' L ');
  });
});

describe('camera', () => {
  test('stage and canvas coordinates invert', () => {
    const fitted = { x: 40, y: 70 };
    const stage = canvasToStage(fitted, 2, -15, 8);
    expect(stageToCanvas(stage, 2, -15, 8)).toEqual(fitted);
  });

  test('the first pinch sample does not jump', () => {
    const current = { scale: 2, translateX: -30, translateY: 12 };
    const focal = { x: 40, y: 70 };
    const baseline = pinchBaseline(current, focal, 1.2);
    const applied = pinchAboutFocal(baseline, focal, 1.2);
    expect(applied.scale).toBeCloseTo(current.scale);
    expect(applied.translateX).toBeCloseTo(current.translateX);
    expect(applied.translateY).toBeCloseTo(current.translateY);
  });

  test('pinch keeps the floor point under a moving focal', () => {
    const current = { scale: 1, translateX: 10, translateY: -4 };
    const startFocal = { x: 50, y: 60 };
    const anchor = stageToCanvas(startFocal, current.scale, current.translateX, current.translateY);
    const baseline = pinchBaseline(current, startFocal, 1);
    const nextFocal = { x: 70, y: 90 };
    const next = pinchAboutFocal(baseline, nextFocal, 2);
    const landed = canvasToStage(anchor, next.scale, next.translateX, next.translateY);
    expect(next.scale).toBe(2);
    expect(landed.x).toBeCloseTo(nextFocal.x);
    expect(landed.y).toBeCloseTo(nextFocal.y);
  });

  test('pinch scale stays inside the map limits', () => {
    const baseline = pinchBaseline({ scale: 1, translateX: 0, translateY: 0 }, { x: 0, y: 0 }, 1);
    expect(pinchAboutFocal(baseline, { x: 0, y: 0 }, 100).scale).toBe(MAX_MAP_SCALE);
    expect(pinchAboutFocal(baseline, { x: 0, y: 0 }, 0.1).scale).toBe(MIN_MAP_SCALE);
  });

  test('pan follows the finger from the current camera', () => {
    const current = { x: 12, y: -3 };
    const baseline = panBaseline(current, { x: 4, y: 5 });
    expect(panTo(baseline, { x: 4, y: 5 })).toEqual(current);
    expect(panTo(baseline, { x: 10, y: 1 })).toEqual({ x: 18, y: -7 });
  });

  test('clamped pan keeps a margin of the map on screen', () => {
    const next = clampTranslation({ x: 10_000, y: -10_000 }, 1, 200, 100, 48);
    expect(next.x).toBe(152);
    expect(next.y).toBe(-52);
  });
});

describe('hitTestPin', () => {
  const pins = [
    { id: 'door', x: 10, y: 10, label: 'door' },
    { id: 'desk', x: 40, y: 10, label: 'desk' },
  ];

  test('the closest pin inside the radius wins', () => {
    expect(hitTestPin(pins, { x: 12, y: 11 }, 8)?.id).toBe('door');
    expect(hitTestPin(pins, { x: 30, y: 10 }, 12)?.id).toBe('desk');
  });

  test('a tap outside the radius misses', () => {
    expect(hitTestPin(pins, { x: 10, y: 40 }, 8)).toBeNull();
  });

  test('a zoomed tap uses fitted coordinates', () => {
    const scale = 2;
    const translateX = -20;
    const translateY = 5;
    const door = canvasToStage(pins[0], scale, translateX, translateY);
    const local = stageToCanvas(door, scale, translateX, translateY);
    expect(hitTestPin(pins, local, 22 / scale)?.label).toBe('door');
  });
});
