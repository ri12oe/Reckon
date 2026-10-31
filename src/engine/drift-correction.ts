/**
 * Drift correction for an already integrated walk.
 *
 * `integratePath` trusts every step length and heading, so a slow heading
 * bias bends a corridor and a loop that returns to a known place fails to
 * close. This module adjusts a finished path. It does not detect steps,
 * fuse a heading, estimate step length, or write `EngineSnapshot`.
 *
 * Three corrections, each a pure function:
 *
 * 1. Corridor snap. A roughly straight run whose heading is close to a
 *    multiple of 45° (the four 90° axes and the four diagonals) is redrawn
 *    along that axis. Step lengths stay. Corners, where the bearing jumps,
 *    start a new run and are not snapped on their own.
 * 2. Loop closure. The walker is back at the start, or at another known
 *    point. The gap between the end and that point is spread along the
 *    path in proportion to distance walked, and the end lands on it.
 * 3. Landmark alignment. The same pin tagged twice is one physical place.
 *    The earlier tag stays. The gap at the later tag is spread between the
 *    two tags, and the path after the later tag shifts with it.
 *
 * `correctDrift` runs them in that order when asked. Loop closure runs
 * last, on the whole path, so a later "I'm back at the start" can move a
 * point that a landmark just pinned. Pass the assertion that should win.
 *
 * Points are meters, x east and y north, the same frame as `PathPoint`.
 * Headings are degrees clockwise from north. The path is in walk order.
 * Inputs are not mutated.
 */

import { stepOffset } from '@/engine/path-integration';
import type { PathPoint } from '@/engine/types';

/** Meters. A shorter segment is not a step and has no bearing. */
const MIN_SEGMENT_M = 1e-9;

/**
 * Corridor axes: 0, 45, 90, 135, 180, 225, 270, 315.
 * Multiples of 90° are the orthogonal halls. The odd multiples of 45°
 * are the diagonal halls. Snap chooses the nearest of these eight.
 */
export const CORRIDOR_AXES_DEG: readonly number[] = [0, 45, 90, 135, 180, 225, 270, 315];

export type CorridorSnapConfig = {
  /**
   * Degrees. A straight run snaps when its mean heading is at most this
   * far from the nearest axis. 15° sits inside the 22.5° boundary between
   * neighboring axes, so a walk aimed between two halls is left alone.
   */
  snapToleranceDeg: number;
  /**
   * Degrees. The bearing changing by more than this starts a new run.
   * 25° keeps a wobbling corridor in one run and splits a real corner.
   */
  turnThresholdDeg: number;
  /**
   * Degrees. Every step in the run must sit within this of the run's
   * length-weighted mean heading. A slow bend that never jumps by
   * `turnThresholdDeg` still does not snap.
   */
  straightToleranceDeg: number;
  /** A single step is not a corridor. */
  minSegments: number;
  /**
   * Net displacement divided by distance walked. A run that doubles back
   * stays put even when a wide tolerance would otherwise call it straight.
   */
  minStraightness: number;
};

export const DEFAULT_CORRIDOR_SNAP_CONFIG: CorridorSnapConfig = {
  snapToleranceDeg: 15,
  turnThresholdDeg: 25,
  straightToleranceDeg: 20,
  minSegments: 2,
  minStraightness: 0.85,
};

export type CorridorAxis = {
  /** Degrees clockwise from north, one of `CORRIDOR_AXES_DEG`. */
  axisDeg: number;
  /** Smallest absolute heading difference from `axisDeg`, in [0, 180]. */
  errorDeg: number;
};

/**
 * Nearest corridor axis.
 * An exact tie (22.5°, 67.5°, …) prefers the multiple of 90°.
 * A non-finite heading reports 0° with error 180°, which does not snap.
 */
export function nearestCorridorAxis(headingDeg: number): CorridorAxis {
  if (!Number.isFinite(headingDeg)) return { axisDeg: 0, errorDeg: 180 };

  const heading = wrap360(headingDeg);
  let axisDeg = 0;
  let errorDeg = 180;
  for (const axis of CORRIDOR_AXES_DEG) {
    const error = Math.abs(wrap180(heading - axis));
    const closer = error < errorDeg - 1e-9;
    const tieToCardinal =
      Math.abs(error - errorDeg) <= 1e-9 && axis % 90 === 0 && axisDeg % 90 !== 0;
    if (closer || tieToCardinal) {
      axisDeg = axis;
      errorDeg = error;
    }
  }
  return { axisDeg, errorDeg };
}

/**
 * Redraw roughly straight runs along the nearest 45° axis.
 * A run that is turning, too short, or too far from every axis is copied
 * with its original shape. A snapped run keeps each step's length and the
 * original timestamps. The first point stays put.
 */
export function snapCorridor(
  path: readonly PathPoint[],
  config?: Partial<CorridorSnapConfig>,
): PathPoint[] {
  if (path.length === 0) return [];
  const resolved = resolveCorridorConfig(config);
  const segments = buildSegments(path);
  const runs = segmentRuns(segments, resolved.turnThresholdDeg);
  const corrected: PathPoint[] = [clonePoint(path[0]!)];

  for (const run of runs) {
    const axis = axisForRun(path, segments, run, resolved);
    for (let index = run.start; index <= run.end; index++) {
      corrected.push(replaySegment(path, corrected, segments, index, axis));
    }
  }

  return corrected;
}

/**
 * Spread the gap between the last point and `target` along the path.
 * `target` defaults to the first point: the walker is back at the start.
 *
 *   corrected[i] = path[i] − (path[last] − target) × arc(0 → i) / arc(0 → last)
 *
 * The first point stays. The last point lands on `target`. A point halfway
 * along the walked distance takes half the correction. Timestamps stay.
 * An empty path, a single point, or an end that is already on the target
 * is copied. With no walked distance the last point is moved onto the
 * target and the earlier points stay.
 */
export function closeLoop(
  path: readonly PathPoint[],
  target?: { x: number; y: number },
): PathPoint[] {
  const corrected = clonePath(path);
  if (path.length < 2) return corrected;

  const start = path[0]!;
  const end = path[path.length - 1]!;
  const goalX = target?.x ?? start.x;
  const goalY = target?.y ?? start.y;
  if (!Number.isFinite(goalX) || !Number.isFinite(goalY)) return corrected;
  if (!Number.isFinite(end.x) || !Number.isFinite(end.y)) return corrected;

  const errorX = end.x - goalX;
  const errorY = end.y - goalY;
  if (errorX === 0 && errorY === 0) return corrected;

  const arc = cumulativeArc(path);
  const total = arc[arc.length - 1]!;
  if (!(total > 0)) {
    const last = corrected.length - 1;
    corrected[last] = { x: goalX, y: goalY, t: corrected[last]!.t };
    return corrected;
  }

  for (let index = 0; index < path.length; index++) {
    const point = path[index]!;
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
    const fraction = arc[index]! / total;
    corrected[index] = {
      x: point.x - errorX * fraction,
      y: point.y - errorY * fraction,
      t: point.t,
    };
  }
  return corrected;
}

/**
 * One tagging of a landmark while the walk is under way.
 * `id` is the pin. Two tags with the same id are the same place.
 * `pathIndex` is the path sample the walker was standing on.
 */
export type LandmarkTag = {
  id: string;
  pathIndex: number;
};

/**
 * Pull later tags of the same id onto the earlier tag.
 *
 * Between the two indexes the gap is spread by distance walked, same
 * weighting as loop closure. The earlier point is the anchor and does not
 * move. Points after the later tag take the full shift, so the rest of
 * the walk stays connected. A third tag of the same id is paired with the
 * second, then that pair is applied the same way. Tags of different ids
 * are not the same place. An index that is missing or out of range is
 * ignored. One tag does nothing.
 */
export function alignLandmarks(
  path: readonly PathPoint[],
  tags: readonly LandmarkTag[],
): PathPoint[] {
  const corrected = clonePath(path);
  for (const pair of anchorPairs(tags, path.length)) {
    applyAnchor(corrected, pair.first, pair.second);
  }
  return corrected;
}

export type DriftCorrectionOptions = {
  /**
   * `true` snaps with `DEFAULT_CORRIDOR_SNAP_CONFIG`. An object overrides
   * those defaults. `false` or omitting it leaves headings alone.
   */
  corridor?: Partial<CorridorSnapConfig> | boolean;
  /** Same id at two path indexes anchors that stretch of the walk. */
  landmarks?: readonly LandmarkTag[];
  /**
   * The walker is back at the start, or at `loopTarget`. The remaining
   * gap is spread over the whole corrected path.
   */
  closeLoop?: boolean;
  /** Where the end should land. Defaults to the first point. */
  loopTarget?: { x: number; y: number };
};

export type DriftCorrection = {
  /** Copy of the input, before any correction. */
  raw: PathPoint[];
  /** Corridor snap, then landmarks, then loop closure, each only if asked. */
  corrected: PathPoint[];
};

/**
 * Run the requested corrections. The result holds both paths, so a caller
 * can keep the raw walk beside the corrected one.
 */
export function correctDrift(
  path: readonly PathPoint[],
  options?: DriftCorrectionOptions,
): DriftCorrection {
  const raw = clonePath(path);
  let corrected = clonePath(path);

  const corridor = options?.corridor;
  if (corridor === true) corrected = snapCorridor(corrected);
  else if (typeof corridor === 'object') corrected = snapCorridor(corrected, corridor);

  if (options?.landmarks !== undefined && options.landmarks.length > 0) {
    corrected = alignLandmarks(corrected, options.landmarks);
  }
  if (options?.closeLoop === true) corrected = closeLoop(corrected, options.loopTarget);

  return { raw, corrected };
}

type Segment = {
  length: number;
  bearing: number | null;
  broken: boolean;
};

type Run = {
  start: number;
  end: number;
};

function resolveCorridorConfig(config?: Partial<CorridorSnapConfig>): CorridorSnapConfig {
  const defaults = DEFAULT_CORRIDOR_SNAP_CONFIG;
  const minStraightness = config?.minStraightness;
  return {
    snapToleranceDeg: nonNegative(config?.snapToleranceDeg, defaults.snapToleranceDeg),
    turnThresholdDeg: nonNegative(config?.turnThresholdDeg, defaults.turnThresholdDeg),
    straightToleranceDeg: nonNegative(config?.straightToleranceDeg, defaults.straightToleranceDeg),
    minSegments: wholeNumberAtLeast1(config?.minSegments, defaults.minSegments),
    minStraightness:
      minStraightness === undefined ||
      !Number.isFinite(minStraightness) ||
      minStraightness < 0 ||
      minStraightness > 1
        ? defaults.minStraightness
        : minStraightness,
  };
}

function buildSegments(path: readonly PathPoint[]): Segment[] {
  const segments: Segment[] = [];
  for (let index = 0; index < path.length - 1; index++) {
    const from = path[index]!;
    const to = path[index + 1]!;
    if (
      !Number.isFinite(from.x) ||
      !Number.isFinite(from.y) ||
      !Number.isFinite(to.x) ||
      !Number.isFinite(to.y)
    ) {
      segments.push({ length: 0, bearing: null, broken: true });
      continue;
    }
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.hypot(dx, dy);
    if (!(length > MIN_SEGMENT_M)) {
      segments.push({ length: 0, bearing: null, broken: false });
      continue;
    }
    segments.push({ length, bearing: bearingDeg(dx, dy), broken: false });
  }
  return segments;
}

function segmentRuns(segments: readonly Segment[], turnThresholdDeg: number): Run[] {
  const runs: Run[] = [];
  let start = 0;
  let previous: number | null = null;

  const close = (end: number) => {
    if (end >= start) runs.push({ start, end });
  };

  for (let index = 0; index < segments.length; index++) {
    const segment = segments[index]!;
    if (segment.broken) {
      if (index > start) close(index - 1);
      runs.push({ start: index, end: index });
      start = index + 1;
      previous = null;
      continue;
    }
    if (segment.bearing === null) continue;
    if (previous !== null && Math.abs(wrap180(segment.bearing - previous)) > turnThresholdDeg) {
      close(index - 1);
      start = index;
    }
    previous = segment.bearing;
  }
  if (start < segments.length) close(segments.length - 1);
  return runs;
}

/** Snapped axis, or null to keep the run's original shape. */
function axisForRun(
  path: readonly PathPoint[],
  segments: readonly Segment[],
  run: Run,
  config: CorridorSnapConfig,
): number | null {
  const samples: { bearing: number; length: number }[] = [];
  for (let index = run.start; index <= run.end; index++) {
    const segment = segments[index]!;
    if (segment.bearing === null || !(segment.length > 0)) continue;
    samples.push({ bearing: segment.bearing, length: segment.length });
  }
  if (samples.length < config.minSegments) return null;

  const mean = weightedCircularMean(samples);
  if (mean === null) return null;
  for (const sample of samples) {
    if (Math.abs(wrap180(sample.bearing - mean)) > config.straightToleranceDeg) return null;
  }

  let walked = 0;
  for (const sample of samples) walked += sample.length;
  const from = path[run.start]!;
  const to = path[run.end + 1]!;
  if (
    !Number.isFinite(from.x) ||
    !Number.isFinite(from.y) ||
    !Number.isFinite(to.x) ||
    !Number.isFinite(to.y)
  ) {
    return null;
  }
  const net = Math.hypot(to.x - from.x, to.y - from.y);
  if (!(walked > 0) || net / walked < config.minStraightness) return null;

  const axis = nearestCorridorAxis(mean);
  if (axis.errorDeg > config.snapToleranceDeg) return null;
  return axis.axisDeg;
}

function weightedCircularMean(
  samples: readonly { bearing: number; length: number }[],
): number | null {
  let east = 0;
  let north = 0;
  let weight = 0;
  for (const sample of samples) {
    const radians = (sample.bearing * Math.PI) / 180;
    east += sample.length * Math.sin(radians);
    north += sample.length * Math.cos(radians);
    weight += sample.length;
  }
  if (!(weight > 0) || (east === 0 && north === 0)) return null;
  return bearingDeg(east, north);
}

function anchorPairs(
  tags: readonly LandmarkTag[],
  pathLength: number,
): { first: number; second: number }[] {
  const byId = new Map<string, number[]>();
  for (const tag of tags) {
    if (!Number.isInteger(tag.pathIndex)) continue;
    if (tag.pathIndex < 0 || tag.pathIndex >= pathLength) continue;
    const indexes = byId.get(tag.id);
    if (indexes) indexes.push(tag.pathIndex);
    else byId.set(tag.id, [tag.pathIndex]);
  }

  const pairs: { first: number; second: number }[] = [];
  for (const indexes of byId.values()) {
    const ordered = [...new Set(indexes)].sort((a, b) => a - b);
    for (let index = 1; index < ordered.length; index++) {
      pairs.push({ first: ordered[index - 1]!, second: ordered[index]! });
    }
  }
  pairs.sort((a, b) => a.second - b.second || a.first - b.first);
  return pairs;
}

function applyAnchor(path: PathPoint[], first: number, second: number): void {
  if (first === second) return;
  const anchor = path[first];
  const visit = path[second];
  if (!anchor || !visit) return;
  if (!Number.isFinite(anchor.x) || !Number.isFinite(anchor.y)) return;
  if (!Number.isFinite(visit.x) || !Number.isFinite(visit.y)) return;

  const errorX = visit.x - anchor.x;
  const errorY = visit.y - anchor.y;
  if (errorX === 0 && errorY === 0) return;

  const arc = cumulativeArc(path);
  const total = arc[second]! - arc[first]!;
  if (!(total > 0)) {
    shiftTail(path, second, errorX, errorY);
    return;
  }

  for (let index = first + 1; index < path.length; index++) {
    const point = path[index]!;
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
    const along = arc[index]! - arc[first]!;
    const fraction = index >= second ? 1 : along / total;
    path[index] = {
      x: point.x - errorX * fraction,
      y: point.y - errorY * fraction,
      t: point.t,
    };
  }
}

function shiftTail(path: PathPoint[], from: number, errorX: number, errorY: number): void {
  for (let index = from; index < path.length; index++) {
    const point = path[index]!;
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
    path[index] = { x: point.x - errorX, y: point.y - errorY, t: point.t };
  }
}

/** Arc length in meters from `path[0]` to each point. A non-finite segment adds nothing. */
function cumulativeArc(path: readonly PathPoint[]): number[] {
  const arc = new Array<number>(path.length).fill(0);
  for (let index = 1; index < path.length; index++) {
    const from = path[index - 1]!;
    const to = path[index]!;
    const finite =
      Number.isFinite(from.x) &&
      Number.isFinite(from.y) &&
      Number.isFinite(to.x) &&
      Number.isFinite(to.y);
    const segment = finite ? Math.hypot(to.x - from.x, to.y - from.y) : 0;
    arc[index] = arc[index - 1]! + segment;
  }
  return arc;
}

/**
 * One step of a replay. A broken or non-finite sample keeps its original
 * coordinates so a gap does not poison the rest of the walk. Otherwise the
 * step hangs off the corrected point before it.
 */
function replaySegment(
  path: readonly PathPoint[],
  corrected: readonly PathPoint[],
  segments: readonly Segment[],
  index: number,
  axis: number | null,
): PathPoint {
  const from = path[index]!;
  const to = path[index + 1]!;
  const prev = corrected[corrected.length - 1]!;
  const segment = segments[index]!;
  const prevFinite = Number.isFinite(prev.x) && Number.isFinite(prev.y);
  if (!prevFinite || segment.broken || !Number.isFinite(to.x) || !Number.isFinite(to.y)) {
    return clonePoint(to);
  }
  if (axis === null || segment.bearing === null) {
    return { x: prev.x + (to.x - from.x), y: prev.y + (to.y - from.y), t: to.t };
  }
  const delta = stepOffset(axis, segment.length);
  return { x: prev.x + delta.x, y: prev.y + delta.y, t: to.t };
}

function bearingDeg(east: number, north: number): number {
  return wrap360((Math.atan2(east, north) * 180) / Math.PI);
}

function wrap360(deg: number): number {
  const wrapped = ((deg % 360) + 360) % 360;
  return wrapped === 0 ? 0 : wrapped;
}

function wrap180(deg: number): number {
  const wrapped = wrap360(deg);
  return wrapped > 180 ? wrapped - 360 : wrapped;
}

function clonePoint(point: PathPoint): PathPoint {
  return { x: point.x, y: point.y, t: point.t };
}

function clonePath(path: readonly PathPoint[]): PathPoint[] {
  return path.map(clonePoint);
}

function nonNegative(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value) || value < 0) return fallback;
  return value;
}

function wholeNumberAtLeast1(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isInteger(value) || value < 1) return fallback;
  return value;
}
