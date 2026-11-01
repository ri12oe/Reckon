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

/**
 * Fold accelerometer samples into step peaks and drop the prefix that can
 * no longer change. `steps()` matches `detectSteps` on the samples seen so
 * far when they arrived in time order, or in any order while the buffer
 * still holds the whole series.
 *
 * The centered smoother only revises the last `floor(window / 2)` samples
 * when a later sample arrives. Peaks older than that are kept, and the raw
 * samples that fed them are dropped once the buffer passes `STEP_SAMPLE_CAP`.
 * A sample older than the dropped prefix is ignored.
 */
export const STEP_SAMPLE_CAP = 256;

/** Out-of-order streams stay exact until this many samples, then the oldest are folded. */
const STEP_UNORDERED_CAP = 4096;

export type StepAccumulator = {
  push(sample: StepSample): void;
  /** Peaks for every sample still represented, committed prefix plus the open tail. */
  steps(): readonly StepEvent[];
  /**
   * Peaks that can no longer change. Empty when an out-of-order sample is
   * still sitting in an unfolded buffer.
   */
  committed(): readonly StepEvent[];
  /** False while an unfolded buffer is not in time order. */
  prefixStable(): boolean;
  oldestRetainedT(): number | null;
  retained(): number;
  /** Samples scanned since the previous take. */
  takeExamined(): number;
  reset(): void;
};

export function createStepAccumulator(config?: Partial<StepDetectorConfig>): StepAccumulator {
  const resolved = resolveConfig(config);
  const half = Math.floor(resolved.smoothWindow / 2);

  let samples: StepSample[] = [];
  let offset = 0;
  let committedSteps: StepEvent[] = [];
  /** Global index of the last committed peak, or -1. */
  let committedThrough = -1;
  let provisional: StepEvent[] = [];
  let cached: StepEvent[] | null = null;
  let dirty = false;
  let monotonic = true;
  let hasSample = false;
  let maxT = Number.NEGATIVE_INFINITY;
  let examined = 0;

  function oldestRetainedT(): number | null {
    if (samples.length === 0) return null;
    if (monotonic) return samples[0]!.t;
    let oldest = samples[0]!.t;
    for (const sample of samples) {
      if (sample.t < oldest) oldest = sample.t;
    }
    return oldest;
  }

  function invalidateTail(oldestKeptT: number): void {
    while (
      committedSteps.length > 0 &&
      committedSteps[committedSteps.length - 1]!.t >= oldestKeptT
    ) {
      committedSteps.pop();
    }
    committedThrough = -1;
    dirty = true;
    cached = null;
  }

  function sync(): void {
    if (!dirty && cached) return;
    dirty = false;

    if (samples.length === 0) {
      provisional = [];
      cached = committedSteps.slice();
      return;
    }

    if (!monotonic && offset === 0) {
      examined += samples.length;
      cached = detectSteps(samples, resolved);
      provisional = [];
      return;
    }

    examined += samples.length;
    const series = toDynamicSeries(samples, resolved.gravity);
    const smoothed = smooth(series.values, resolved.smoothWindow);
    const limit = series.times.length - 2 - half;
    const minIndex = offset === 0 ? 1 : half + 1;
    const start = Math.max(minIndex, committedThrough - offset + 1);
    let lastStepT =
      committedSteps.length > 0
        ? committedSteps[committedSteps.length - 1]!.t
        : Number.NEGATIVE_INFINITY;
    provisional = [];

    for (let index = start; index < series.times.length - 1; index++) {
      if (offset + index <= committedThrough) continue;
      const value = smoothed[index]!;
      if (value < resolved.peakThreshold) continue;
      if (value < smoothed[index - 1]! || value <= smoothed[index + 1]!) continue;
      const t = series.times[index]!;
      if (t - lastStepT < resolved.minIntervalMs) continue;
      const event: StepEvent = { t, peakMps2: value };
      if (index <= limit) {
        committedSteps.push(event);
        committedThrough = offset + index;
      } else {
        provisional.push(event);
      }
      lastStepT = t;
    }

    cached = committedSteps.concat(provisional);
  }

  function sampleCap(): number {
    // The smoother's context has to fit, even if the caller widens the window.
    return Math.max(STEP_SAMPLE_CAP, 2 + 2 * half + 1);
  }

  function compact(): void {
    if (!monotonic || samples.length <= sampleCap()) return;
    sync();
    const limit = samples.length - 2 - half;
    // Keep the left context of the first peak that is still allowed to move.
    const retainFrom = limit - half;
    if (retainFrom <= 0) return;
    samples = samples.slice(retainFrom);
    offset += retainFrom;
  }

  function foldUnordered(): void {
    if (monotonic || offset !== 0 || samples.length <= STEP_UNORDERED_CAP) return;
    samples.sort((a, b) => a.t - b.t);
    monotonic = true;
    committedSteps = [];
    committedThrough = -1;
    dirty = true;
    cached = null;
    sync();
    compact();
  }

  return {
    push(sample) {
      if (!Number.isFinite(sample.t)) return;
      const magnitude = rawMagnitude(sample);
      if (!Number.isFinite(magnitude)) return;
      const copy = copyStepSample(sample);

      if (hasSample && copy.t < maxT) {
        if (offset === 0) {
          // The whole series is still buffered, so a late sample can join it.
          monotonic = false;
          committedSteps = [];
          committedThrough = -1;
        } else if (samples.length > 0 && copy.t >= samples[0]!.t) {
          invalidateTail(samples[0]!.t);
        } else {
          return;
        }
      } else if (!hasSample || copy.t > maxT) {
        maxT = copy.t;
      }

      hasSample = true;
      samples.push(copy);
      dirty = true;
      cached = null;
      if (monotonic) {
        const previous = samples[samples.length - 2];
        if (previous && copy.t < previous.t) samples.sort((a, b) => a.t - b.t);
        compact();
      } else {
        foldUnordered();
      }
    },
    steps() {
      sync();
      return cached ?? [];
    },
    committed() {
      if (!monotonic) return [];
      sync();
      return committedSteps;
    },
    prefixStable() {
      return monotonic;
    },
    oldestRetainedT,
    retained() {
      return samples.length;
    },
    takeExamined() {
      const taken = examined;
      examined = 0;
      return taken;
    },
    reset() {
      samples = [];
      offset = 0;
      committedSteps = [];
      committedThrough = -1;
      provisional = [];
      cached = null;
      dirty = false;
      monotonic = true;
      hasSample = false;
      maxT = Number.NEGATIVE_INFINITY;
      examined = 0;
    },
  };
}

function copyStepSample(sample: StepSample): StepSample {
  if ('x' in sample) return { t: sample.t, x: sample.x, y: sample.y, z: sample.z };
  return { t: sample.t, magnitude: sample.magnitude };
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
