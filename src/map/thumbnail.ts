type XY = { x: number; y: number };

export type ThumbnailSegment = {
  /** Center of the segment. */
  x: number;
  y: number;
  length: number;
  /** Radians, measured from the +x axis toward +y (screen space). */
  angle: number;
};

export type Thumbnail = {
  segments: ThumbnailSegment[];
  start: XY | null;
};

/** Keep every nth point so a long walk stays a few dozen segments. */
function thin<T>(points: readonly T[], max: number): T[] {
  if (points.length <= max) return [...points];
  const step = (points.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, i) => points[Math.round(i * step)]);
}

/**
 * Fit a walk into a `size`-square preview (y up becomes y down) and split it
 * into straight segments that can be drawn as rotated bars.
 */
export function pathThumbnail(points: readonly XY[], size: number, pad = 8, max = 32): Thumbnail {
  const finite = points.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  if (finite.length === 0 || size <= pad * 2) return { segments: [], start: null };

  const xs = finite.map((p) => p.x);
  const ys = finite.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxY = Math.max(...ys);
  const spanX = Math.max(Math.max(...xs) - minX, 1e-6);
  const spanY = Math.max(maxY - Math.min(...ys), 1e-6);
  const inner = size - pad * 2;
  const scale = Math.min(inner / spanX, inner / spanY);
  const offsetX = (size - spanX * scale) / 2;
  const offsetY = (size - spanY * scale) / 2;
  const place = (p: XY): XY => ({
    x: offsetX + (p.x - minX) * scale,
    y: offsetY + (maxY - p.y) * scale,
  });

  const placed = thin(finite, max).map(place);
  const segments: ThumbnailSegment[] = [];
  for (let i = 1; i < placed.length; i++) {
    const a = placed[i - 1];
    const b = placed[i];
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (length < 0.5) continue;
    segments.push({
      x: (a.x + b.x) / 2,
      y: (a.y + b.y) / 2,
      length,
      angle: Math.atan2(b.y - a.y, b.x - a.x),
    });
  }
  return { segments, start: placed[0] };
}
