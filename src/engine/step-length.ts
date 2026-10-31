/**
 * Step length from a known-distance calibration walk.
 *
 * The walker covers a measured course (a taped line, a known hallway).
 * The step count is how many steps fell on that course. Mean length is
 *
 *   stepLength = distanceM / stepCount
 *
 * in meters per step, the `stepLength` argument of `integratePath`.
 * Before a walk produces an estimate, callers keep the length they already
 * use. The path integrator's default is 0.75 m.
 *
 * A course with no usable steps, a non-positive distance, a non-integer
 * count, or a ratio that is not a positive finite number has no estimate.
 * The ratio is not clamped to a typical human stride.
 *
 * Not in this module: path integration, corridor snap, loop closure,
 * landmarks, or any other drift correction. The measured distance is an
 * input; this module does not infer it.
 */

import { DEFAULT_STEP_LENGTH_M } from '@/engine/path-integration';

export type CalibrationWalk = {
  /** Measured course length, meters. Finite and greater than 0. */
  distanceM: number;
  /**
   * Steps taken on that course. A finite integer of at least 1.
   * A fractional number is not a step count.
   */
  stepCount: number;
};

export type StepLengthEstimate = {
  /** Meters per step: distanceM / stepCount. Positive and finite. */
  stepLengthM: number;
  /** Course length that produced this estimate, meters. */
  distanceM: number;
  /** Step count that produced this estimate. */
  stepCount: number;
};

/**
 * Mean step length for one calibration walk.
 * Returns null when the walk cannot produce a positive finite length.
 */
export function estimateStepLength(walk: CalibrationWalk): StepLengthEstimate | null {
  const { distanceM, stepCount } = walk;
  if (!Number.isFinite(distanceM) || distanceM <= 0) return null;
  if (!Number.isInteger(stepCount) || stepCount < 1) return null;

  const stepLengthM = distanceM / stepCount;
  if (!Number.isFinite(stepLengthM) || stepLengthM <= 0) return null;

  return { stepLengthM, distanceM, stepCount };
}

/**
 * How many of `steps` count toward a calibration.
 * A non-finite timestamp is not a step, the same rule as path integration.
 * Two events at the same time are two steps. Heading is ignored.
 */
export function countCalibrationSteps(steps: readonly { t: number }[]): number {
  let count = 0;
  for (const step of steps) {
    if (Number.isFinite(step.t)) count += 1;
  }
  return count;
}

/**
 * Step length from a measured distance and the steps detected on that walk.
 * Returns null when no finite-timestamp step remains, or the distance is unusable.
 */
export function estimateStepLengthFromSteps(
  distanceM: number,
  steps: readonly { t: number }[],
): StepLengthEstimate | null {
  return estimateStepLength({ distanceM, stepCount: countCalibrationSteps(steps) });
}

/**
 * Meters per step to pass to `integratePath`.
 * The calibrated length when `estimate` has a finite `stepLengthM`;
 * otherwise `fallback` (default 0.75 m). A non-finite fallback is the default.
 */
export function stepLengthOrDefault(
  estimate: StepLengthEstimate | null,
  fallback: number = DEFAULT_STEP_LENGTH_M,
): number {
  const calibrated = estimate?.stepLengthM;
  if (calibrated !== undefined && Number.isFinite(calibrated)) return calibrated;
  if (Number.isFinite(fallback)) return fallback;
  return DEFAULT_STEP_LENGTH_M;
}
