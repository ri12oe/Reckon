/**
 * Peak-detector step counter for a sequence of raw accelerometer samples.
 *
 * The live app does not read the platform pedometer. Callers pass samples in;
 * this module only does math:
 *
 * 1. Magnitude m = sqrt(x² + y² + z²), in m/s², gravity included.
 * 2. Dynamic acceleration d = m − gravity (standard gravity by default).
 * 3. A short centered moving average, so a one-sample spike is not a step.
 * 4. Local maxima at or above `peakThreshold`.
 * 5. A refractory gap of `minIntervalMs`, so heel-strike and toe-off count once.
 *
 * Timestamps are milliseconds, the same clock as `PathPoint.t`.
 */

export const STANDARD_GRAVITY_MPS2 = 9.80665;

export type AccelSample = {
  /** Milliseconds. */
  t: number;
  /** Device x, m/s², gravity included. */
  x: number;
  /** Device y, m/s², gravity included. */
  y: number;
  /** Device z, m/s², gravity included. */
  z: number;
};

/** Precomputed magnitude in m/s². Includes gravity unless `gravity` is set to 0. */
export type AccelMagnitudeSample = {
  t: number;
  magnitude: number;
};

export type StepSample = AccelSample | AccelMagnitudeSample;

export type StepEvent = {
  /** Time of the peak sample, in milliseconds. */
  t: number;
  /** Smoothed dynamic acceleration at that peak, m/s² above gravity. */
  peakMps2: number;
};

export type StepDetectorConfig = {
  /** Local maximum must reach this dynamic acceleration, m/s². */
  peakThreshold: number;
  /** Ignore later peaks this soon after an accepted step, milliseconds. */
  minIntervalMs: number;
  /** Centered moving-average length in samples. 1 disables smoothing. */
  smoothWindow: number;
  /**
   * Subtracted from the magnitude. Use 0 when samples are already linear
   * acceleration (gravity removed).
   */
  gravity: number;
};

export const DEFAULT_STEP_DETECTOR_CONFIG: StepDetectorConfig = {
  peakThreshold: 1.2,
  minIntervalMs: 300,
  smoothWindow: 5,
  gravity: STANDARD_GRAVITY_MPS2,
};

export function accelerationMagnitude(sample: AccelSample): number {
  return Math.hypot(sample.x, sample.y, sample.z);
}

export function detectSteps(
  samples: readonly StepSample[],
  config?: Partial<StepDetectorConfig>,
): StepEvent[] {
  const resolved = resolveConfig(config);
  const series = toDynamicSeries(samples, resolved.gravity);
  if (series.times.length < 3) return [];

  const dynamic = smooth(series.values, resolved.smoothWindow);
  const steps: StepEvent[] = [];
  let lastStepT = Number.NEGATIVE_INFINITY;

  for (let i = 1; i < dynamic.length - 1; i++) {
    const value = dynamic[i]!;
    if (value < resolved.peakThreshold) continue;
    if (value < dynamic[i - 1]! || value <= dynamic[i + 1]!) continue;
    const t = series.times[i]!;
    if (t - lastStepT < resolved.minIntervalMs) continue;
    steps.push({ t, peakMps2: value });
    lastStepT = t;
  }

  return steps;
}

export function countSteps(
  samples: readonly StepSample[],
  config?: Partial<StepDetectorConfig>,
): number {
  return detectSteps(samples, config).length;
}

function resolveConfig(config?: Partial<StepDetectorConfig>): StepDetectorConfig {
  const defaults = DEFAULT_STEP_DETECTOR_CONFIG;
  const peakThreshold = config?.peakThreshold;
  const minIntervalMs = config?.minIntervalMs;
  const smoothWindow = config?.smoothWindow;
  const gravity = config?.gravity;

  return {
    peakThreshold:
      peakThreshold === undefined || !Number.isFinite(peakThreshold)
        ? defaults.peakThreshold
        : peakThreshold,
    minIntervalMs:
      minIntervalMs === undefined || !Number.isFinite(minIntervalMs) || minIntervalMs < 0
        ? defaults.minIntervalMs
        : minIntervalMs,
    smoothWindow:
      smoothWindow === undefined || !Number.isFinite(smoothWindow)
        ? defaults.smoothWindow
        : Math.max(1, Math.floor(smoothWindow)),
    gravity: gravity === undefined || !Number.isFinite(gravity) ? defaults.gravity : gravity,
  };
}

function rawMagnitude(sample: StepSample): number {
  if ('x' in sample) return accelerationMagnitude(sample);
  return sample.magnitude;
}

function toDynamicSeries(
  samples: readonly StepSample[],
  gravity: number,
): { times: number[]; values: number[] } {
  const timed: { t: number; magnitude: number }[] = [];
  for (const sample of samples) {
    if (!Number.isFinite(sample.t)) continue;
    const magnitude = rawMagnitude(sample);
    if (!Number.isFinite(magnitude)) continue;
    timed.push({ t: sample.t, magnitude });
  }
  timed.sort((a, b) => a.t - b.t);

  const times: number[] = [];
  const values: number[] = [];
  for (const sample of timed) {
    times.push(sample.t);
    values.push(sample.magnitude - gravity);
  }
  return { times, values };
}

/** Centered moving average. The window shrinks at the ends instead of dropping samples. */
function smooth(values: readonly number[], window: number): number[] {
  if (window <= 1 || values.length === 0) return values.slice();

  const half = Math.floor(window / 2);
  const prefix = new Array<number>(values.length + 1);
  prefix[0] = 0;
  for (let i = 0; i < values.length; i++) {
    prefix[i + 1] = prefix[i]! + values[i]!;
  }

  const out = new Array<number>(values.length);
  for (let i = 0; i < values.length; i++) {
    const start = Math.max(0, i - half);
    const end = Math.min(values.length - 1, i + half);
    out[i] = (prefix[end + 1]! - prefix[start]!) / (end - start + 1);
  }
  return out;
}
