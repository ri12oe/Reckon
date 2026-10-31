/**
 * Dead-reckoning path integration.
 *
 * Each step moves the walker by a fixed length. x is meters east, y is
 * meters north, and heading is degrees clockwise from north — the same
 * convention as `PathPoint` and `EngineSnapshot.heading`:
 *
 *   x += stepLength × sin(heading)
 *   y += stepLength × cos(heading)
 *
 * The returned path starts at the origin, the position before any step.
 * Each accepted step appends one point at that step's timestamp, so
 * `path[0]` is before the walk and `path[path.length - 1]` is after it.
 *
 * Heading for a step is that step's own `heading` when it is finite.
 * Otherwise it is the constant passed in, or the latest heading sample at
 * or before the step (zero-order hold). A sample that is only in the
 * future is not used. Until the first sample, the heading is 0° (north).
 *
 * `stepLength` is meters per step and is constant for the call. This
 * module does not estimate it from the walker.
 *
 * Not in this module: step-length calibration, corridor snap, loop
 * closure, landmarks, or any other drift correction.
 */

import type { PathPoint } from '@/engine/types';

/** Meters. A fixed length, not a calibrated estimate. */
export const DEFAULT_STEP_LENGTH_M = 0.75;

export type HeadingSample = {
  /** Milliseconds. Same clock as `PathPoint.t`. */
  t: number;
  /** Degrees clockwise from north. */
  heading: number;
};

/**
 * A step time, optionally already paired with a heading.
 * `StepEvent` from the step detector is accepted: it has `t` and no heading.
 */
export type PathStep = {
  /** Milliseconds. Same clock as `PathPoint.t`. */
  t: number;
  /** Degrees clockwise from north. Overrides the heading argument when finite. */
  heading?: number;
};

export type PathIntegrationConfig = {
  /** Meters per step. Any finite value, including 0, is used as given. */
  stepLength: number;
  /** Origin easting, meters. The position before the first step. */
  originX: number;
  /** Origin northing, meters. */
  originY: number;
  /** Origin timestamp, milliseconds. */
  originT: number;
};

export const DEFAULT_PATH_INTEGRATION_CONFIG: PathIntegrationConfig = {
  stepLength: DEFAULT_STEP_LENGTH_M,
  originX: 0,
  originY: 0,
  originT: 0,
};

/** East and north displacement of one step, in meters. */
export function stepOffset(headingDeg: number, stepLength: number): { x: number; y: number } {
  if (!Number.isFinite(headingDeg) || !Number.isFinite(stepLength)) {
    return { x: 0, y: 0 };
  }
  const radians = (headingDeg * Math.PI) / 180;
  return {
    x: stepLength * Math.sin(radians),
    y: stepLength * Math.cos(radians),
  };
}

/**
 * Integrate steps into a path.
 *
 * `heading` is degrees clockwise from north: one constant for every step
 * that does not carry its own, or a sample stream held from the latest
 * sample at or before each step. An empty stream holds 0°.
 */
export function integratePath(
  steps: readonly PathStep[],
  heading: number | readonly HeadingSample[] = 0,
  config?: Partial<PathIntegrationConfig>,
): PathPoint[] {
  const resolved = resolveConfig(config);
  const course = resolveHeading(heading);
  const ordered = orderSteps(steps);

  let x = resolved.originX;
  let y = resolved.originY;
  const path: PathPoint[] = [{ x, y, t: resolved.originT }];

  for (const step of ordered) {
    const delta = stepOffset(headingForStep(step, course), resolved.stepLength);
    x += delta.x;
    y += delta.y;
    path.push({ x, y, t: step.t });
  }

  return path;
}

type Course = { kind: 'constant'; heading: number } | { kind: 'series'; samples: HeadingSample[] };

function resolveHeading(heading: number | readonly HeadingSample[]): Course {
  if (typeof heading === 'number') {
    return { kind: 'constant', heading: Number.isFinite(heading) ? heading : 0 };
  }

  const samples: HeadingSample[] = [];
  for (const sample of heading) {
    if (!Number.isFinite(sample.t) || !Number.isFinite(sample.heading)) continue;
    samples.push({ t: sample.t, heading: sample.heading });
  }
  samples.sort((a, b) => a.t - b.t);

  const collapsed: HeadingSample[] = [];
  for (const sample of samples) {
    const previous = collapsed[collapsed.length - 1];
    if (previous && previous.t === sample.t) previous.heading = sample.heading;
    else collapsed.push(sample);
  }

  if (collapsed.length === 0) return { kind: 'constant', heading: 0 };
  return { kind: 'series', samples: collapsed };
}

function orderSteps(steps: readonly PathStep[]): PathStep[] {
  const indexed: { step: PathStep; index: number }[] = [];
  for (let index = 0; index < steps.length; index++) {
    const step = steps[index]!;
    if (!Number.isFinite(step.t)) continue;
    indexed.push({ step, index });
  }
  indexed.sort((a, b) => a.step.t - b.step.t || a.index - b.index);
  return indexed.map(({ step }) => step);
}

function headingForStep(step: PathStep, course: Course): number {
  if (step.heading !== undefined && Number.isFinite(step.heading)) return step.heading;
  if (course.kind === 'constant') return course.heading;
  return holdHeading(course.samples, step.t);
}

/** Latest sample at or before `t`. 0° when every sample is still in the future. */
function holdHeading(samples: readonly HeadingSample[], t: number): number {
  let lo = 0;
  let hi = samples.length - 1;
  let heading = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const sample = samples[mid]!;
    if (sample.t <= t) {
      heading = sample.heading;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return heading;
}

function resolveConfig(config?: Partial<PathIntegrationConfig>): PathIntegrationConfig {
  const defaults = DEFAULT_PATH_INTEGRATION_CONFIG;
  const stepLength = config?.stepLength;
  return {
    stepLength:
      stepLength === undefined || !Number.isFinite(stepLength) ? defaults.stepLength : stepLength,
    originX: finiteOr(config?.originX, defaults.originX),
    originY: finiteOr(config?.originY, defaults.originY),
    originT: finiteOr(config?.originT, defaults.originT),
  };
}

function finiteOr(value: number | undefined, fallback: number): number {
  return value === undefined || !Number.isFinite(value) ? fallback : value;
}
