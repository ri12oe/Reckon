import type { PathPoint } from '@/engine/types';

const DIRECTIONS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;

/** Meters walked along a path, skipping points that are not finite. */
export function pathLength(points: readonly PathPoint[]): number {
  let total = 0;
  let previous: PathPoint | null = null;
  for (const point of points) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
    if (previous) total += Math.hypot(point.x - previous.x, point.y - previous.y);
    previous = point;
  }
  return total;
}

/** "45.8 m" under a kilometer, "1.24 km" above. */
export function formatDistance(meters: number): string {
  if (!Number.isFinite(meters) || meters <= 0) return '0 m';
  if (meters >= 1000) return `${(meters / 1000).toFixed(2)} km`;
  return `${meters.toFixed(1)} m`;
}

/** Heading in degrees clockwise from north to an 8-point compass label. */
export function compassPoint(heading: number): (typeof DIRECTIONS)[number] {
  if (!Number.isFinite(heading)) return 'N';
  const normalized = ((heading % 360) + 360) % 360;
  return DIRECTIONS[Math.round(normalized / 45) % 8];
}

export function formatHeading(heading: number): string {
  const degrees = Number.isFinite(heading) ? Math.round(((heading % 360) + 360) % 360) : 0;
  return `${degrees % 360}° ${compassPoint(heading)}`;
}
