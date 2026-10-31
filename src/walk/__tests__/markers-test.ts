import { headingCone } from '@/walk/markers';

function tip(path: string) {
  const points = [...path.matchAll(/L (-?[\d.]+) (-?[\d.]+)/g)].map((m) => ({
    x: Number(m[1]),
    y: Number(m[2]),
  }));
  return points[Math.floor(points.length / 2)];
}

describe('headingCone', () => {
  const center = { x: 100, y: 100 };

  test('north points up the screen', () => {
    const p = tip(headingCone(center, 0, 30));
    expect(p.x).toBeCloseTo(100);
    expect(p.y).toBeCloseTo(70);
  });

  test('east points right', () => {
    const p = tip(headingCone(center, 90, 30));
    expect(p.x).toBeCloseTo(130);
    expect(p.y).toBeCloseTo(100);
  });

  test('starts and closes at the center', () => {
    const path = headingCone(center, 45);
    expect(path.startsWith('M 100 100')).toBe(true);
    expect(path.endsWith('Z')).toBe(true);
  });

  test('a missing heading points north', () => {
    expect(headingCone(center, NaN)).toBe(headingCone(center, 0));
  });
});
