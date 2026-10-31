import { compassPoint, formatDistance, formatHeading, pathLength } from '@/walk/stats';

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
});
