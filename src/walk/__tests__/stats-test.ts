import { mockEngine } from '@/engine/mock-engine';
import type { EngineSnapshot } from '@/engine/types';
import {
  compassPoint,
  formatDistance,
  formatHeading,
  headingIsGyroOnly,
  pathLength,
  walkReadout,
  walkSummary,
} from '@/walk/stats';

const at = (x: number, y: number) => ({ x, y, t: 0 });

describe('pathLength', () => {
  test('adds up each leg of the path', () => {
    expect(pathLength([at(0, 0), at(3, 4), at(3, 10)])).toBeCloseTo(11);
  });

  test('an empty or single-point path is zero', () => {
    expect(pathLength([])).toBe(0);
    expect(pathLength([at(2, 2)])).toBe(0);
  });

  test('skips points that are not finite', () => {
    expect(pathLength([at(0, 0), at(NaN, 5), at(0, 2)])).toBeCloseTo(2);
  });
});

describe('formatDistance', () => {
  test('meters to one decimal, kilometers past 1000 m', () => {
    expect(formatDistance(45.83)).toBe('45.8 m');
    expect(formatDistance(1240)).toBe('1.24 km');
    expect(formatDistance(0)).toBe('0 m');
    expect(formatDistance(NaN)).toBe('0 m');
  });
});

describe('compass headings', () => {
  test('rounds to the nearest of 8 points', () => {
    expect(compassPoint(0)).toBe('N');
    expect(compassPoint(60)).toBe('NE');
    expect(compassPoint(90)).toBe('E');
    expect(compassPoint(200)).toBe('S');
    expect(compassPoint(350)).toBe('N');
    expect(compassPoint(-90)).toBe('W');
  });

  test('formats degrees with the compass point', () => {
    expect(formatHeading(60.4)).toBe('60° NE');
    expect(formatHeading(-90)).toBe('270° W');
    expect(formatHeading(359.7)).toBe('0° N');
    expect(formatHeading(NaN)).toBe('0° N');
  });

  test('only fused gyro propagation dims the heading', () => {
    expect(headingIsGyroOnly(true)).toBe(true);
    expect(headingIsGyroOnly(false)).toBe(false);
    expect(headingIsGyroOnly(undefined)).toBe(false);
  });
});

describe('walk readout before a live sample', () => {
  test('the canned picture stays 12 steps and 7 points, and the readout is empty', () => {
    const picture = mockEngine.getSnapshot();
    expect(picture.stepCount).toBe(12);
    expect(picture.correctedPath).toHaveLength(7);
    expect(picture.rawPath).toHaveLength(7);
    expect(pathLength(picture.correctedPath)).toBeCloseTo(9);
    expect(formatDistance(pathLength(picture.correctedPath))).toBe('9.0 m');

    const readout = walkReadout(picture);
    expect(readout).toEqual({ stepCount: 0, distance: '0 m', pinCount: 0 });
    expect(walkSummary(readout)).toBe('0 steps · 0 m · 0 pins');
  });

  test('a picture that matches the demo reads as empty without the flag', () => {
    const copy: EngineSnapshot = { ...mockEngine.getSnapshot() };
    delete copy.isCannedDemo;
    expect(walkReadout(copy)).toEqual({ stepCount: 0, distance: '0 m', pinCount: 0 });
  });

  test('an overlaid demo pin still does not count as a dropped pin', () => {
    const picture = mockEngine.getSnapshot();
    const overlaid: EngineSnapshot = {
      ...picture,
      pins: [...picture.pins, { id: 'extra', x: 1, y: 1, label: 'extra' }],
    };
    expect(walkReadout(overlaid)).toEqual({ stepCount: 0, distance: '0 m', pinCount: 0 });
  });

  test('a live walk keeps its steps, distance, and pins', () => {
    const live: EngineSnapshot = {
      rawPath: [at(0, 0), at(3, 4)],
      correctedPath: [at(0, 0), at(3, 4)],
      stepCount: 1,
      heading: 10,
      pins: [{ id: 'desk', x: 3, y: 4, label: 'desk' }],
    };
    const readout = walkReadout(live);
    expect(readout).toEqual({ stepCount: 1, distance: '5.0 m', pinCount: 1 });
    expect(walkSummary(readout)).toBe('1 steps · 5.0 m · 1 pin');
  });
});
