import { pathThumbnail } from '@/map/thumbnail';

const at = (x: number, y: number) => ({ x, y });

describe('pathThumbnail', () => {
  test('an L-shaped walk becomes two segments inside the box', () => {
    const { segments, start } = pathThumbnail([at(0, 0), at(10, 0), at(10, 10)], 64, 8);
    expect(segments).toHaveLength(2);
    expect(start).toEqual({ x: 8, y: 56 });
    // East leg runs left to right along the bottom.
    expect(segments[0].angle).toBeCloseTo(0);
    expect(segments[0].length).toBeCloseTo(48);
    // North leg runs up the screen.
    expect(segments[1].angle).toBeCloseTo(-Math.PI / 2);
    for (const s of segments) {
      expect(s.x).toBeGreaterThanOrEqual(8);
      expect(s.x).toBeLessThanOrEqual(56);
    }
  });

  test('a straight walk is centered across the box', () => {
    const { segments } = pathThumbnail([at(0, 0), at(5, 0)], 64, 8);
    expect(segments).toHaveLength(1);
    expect(segments[0].y).toBeCloseTo(32);
    expect(segments[0].length).toBeCloseTo(48);
  });

  test('long walks are thinned to the limit', () => {
    const points = Array.from({ length: 200 }, (_, i) => at(i, Math.sin(i / 10) * 20));
    const { segments } = pathThumbnail(points, 64, 8, 32);
    expect(segments.length).toBeLessThanOrEqual(31);
    expect(segments.length).toBeGreaterThan(20);
  });

  test('empty or non-finite input draws nothing', () => {
    expect(pathThumbnail([], 64)).toEqual({ segments: [], start: null });
    expect(pathThumbnail([at(NaN, 1)], 64)).toEqual({ segments: [], start: null });
  });
});
