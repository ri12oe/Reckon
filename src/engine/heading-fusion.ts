/**
 * Complementary-filter heading fusion for pedestrian dead reckoning.
 *
 * Heading is degrees clockwise from north, the same convention as
 * `EngineSnapshot.heading`. The magnetometer observes magnetic north;
 * declination is left to the caller.
 *
 * 1. Integrate gyroscope yaw. It is smooth and it drifts.
 * 2. Blend the magnetometer heading with time constant `tauSeconds`.
 *    The magnetometer is absolute and noisy.
 * 3. When the field is interfered, stop the blend and trust the gyro
 *    until the magnetometer is trustworthy again for `recoverHoldMs`.
 *
 * Interference is any of:
 * - magnitude outside the Earth-field window, or too far from the trusted baseline
 * - a heading jump the gyroscope did not measure
 * - a sustained disagreement larger than `reacquireMaxDeg`
 *
 * The first in-range magnetometer sample snaps the heading. The recovery
 * hold applies only after that fix has been lost.
 *
 * Device frame: +x forward, +y right, +z down, microtesla.
 * `yawRate` is radians per second, positive clockwise.
 * Streams may be unsynchronized; both are sorted by timestamp.
 *
 * Gyro rate is zero-order held: the rate on a sample applies until the
 * next gyroscope sample. At a shared timestamp the gyro is integrated
 * first, then the magnetometer may correct.
 *
 * Not in this module: step length, path integration, loop-closure drift.
 */

export type GyroSample = {
  /** Milliseconds. */
  t: number;
  /** Radians per second, positive clockwise (same sense as heading). */
  yawRate: number;
};

export type MagSample = {
  /** Milliseconds. */
  t: number;
  /** Microtesla, device +x forward. */
  x: number;
  /** Microtesla, device +y right. */
  y: number;
  /** Microtesla, device +z down. */
  z: number;
};

export type FusedHeading = {
  /** Milliseconds. */
  t: number;
  /** Degrees clockwise from magnetic north, in [0, 360). */
  heading: number;
  /**
   * Heading is gyroscope propagation: there is no magnetometer fix yet,
   * or magnetic interference is latched, including the recovery hold.
   * A timestamp that simply has no magnetometer sample is not gyro-only.
   */
  gyroOnly: boolean;
  /** Magnetic interference is latched after this timestamp. */
  interference: boolean;
  /** Compass heading of the magnetometer sample at this time, or null. */
  magneticHeading: number | null;
  /** Field magnitude in microtesla if a magnetometer sample was present. */
  magnitudeUt: number | null;
};

export type HeadingFusionConfig = {
  /** Magnetometer blend time constant, seconds. Larger trusts the gyro longer. */
  tauSeconds: number;
  /** Minimum plausible Earth-field magnitude, microtesla. */
  magnitudeMinUt: number;
  /** Maximum plausible Earth-field magnitude, microtesla. */
  magnitudeMaxUt: number;
  /**
   * Relative deviation from the trusted magnitude baseline that counts
   * as interference. 0.3 rejects a 30% change.
   */
  magnitudeDeviation: number;
  /** Horizontal component below this, microtesla, has no usable heading. */
  minHorizontalUt: number;
  /**
   * A magnetometer step this many degrees beyond the gyro step is a jump.
   */
  jumpThresholdDeg: number;
  /**
   * While tracking, or when trying to reacquire, a magnetometer heading
   * farther than this from the gyro heading is not trusted.
   */
  reacquireMaxDeg: number;
  /** Clean magnetometer time required before blending again, milliseconds. */
  recoverHoldMs: number;
  /** Heading used until the first trusted magnetometer sample, degrees. */
  initialHeadingDeg: number;
  /** Time constant for the trusted magnitude baseline, seconds. */
  baselineTauSeconds: number;
};

export const DEFAULT_HEADING_FUSION_CONFIG: HeadingFusionConfig = {
  tauSeconds: 1.5,
  magnitudeMinUt: 20,
  magnitudeMaxUt: 70,
  magnitudeDeviation: 0.3,
  minHorizontalUt: 5,
  jumpThresholdDeg: 25,
  reacquireMaxDeg: 30,
  recoverHoldMs: 400,
  initialHeadingDeg: 0,
  baselineTauSeconds: 10,
};

/** |B| in microtesla. */
export function magneticFieldMagnitude(x: number, y: number, z: number): number {
  return Math.hypot(x, y, z);
}

/**
 * Compass heading, degrees clockwise from magnetic north.
 * +x forward and +y right: north is +x, east is −y.
 * A zero horizontal field does not define a heading; callers should check.
 */
export function magneticHeadingDeg(x: number, y: number): number {
  return wrap360((Math.atan2(-y, x) * 180) / Math.PI);
}

export function fuseHeading(
  gyro: readonly GyroSample[],
  mag: readonly MagSample[],
  config?: Partial<HeadingFusionConfig>,
): FusedHeading[] {
  const resolved = resolveConfig(config);
  const events = collectEvents(gyro, mag);
  const state = createState(resolved.initialHeadingDeg);
  const fused: FusedHeading[] = [];

  let index = 0;
  while (index < events.length) {
    const t = events[index]!.t;
    let end = index + 1;
    while (end < events.length && events[end]!.t === t) end += 1;
    fused.push(step(state, t, events.slice(index, end), resolved));
    index = end;
  }

  return fused;
}

type GyroEvent = { t: number; rank: 0; yawRate: number };
type MagEvent = { t: number; rank: 1; x: number; y: number; z: number };
type TimedEvent = GyroEvent | MagEvent;

type FusionState = {
  heading: number;
  yawDegPerSec: number;
  lastT: number | null;
  hasFix: boolean;
  interfered: boolean;
  cleanSince: number | null;
  baselineUt: number | null;
  lastMagHeading: number | null;
  headingMark: number;
  lastTrustedT: number | null;
};

function createState(initialHeadingDeg: number): FusionState {
  const heading = wrap360(initialHeadingDeg);
  return {
    heading,
    yawDegPerSec: 0,
    lastT: null,
    hasFix: false,
    interfered: false,
    cleanSince: null,
    baselineUt: null,
    lastMagHeading: null,
    headingMark: heading,
    lastTrustedT: null,
  };
}

function collectEvents(gyro: readonly GyroSample[], mag: readonly MagSample[]): TimedEvent[] {
  const events: TimedEvent[] = [];

  for (const sample of gyro) {
    if (!Number.isFinite(sample.t) || !Number.isFinite(sample.yawRate)) continue;
    events.push({ t: sample.t, rank: 0, yawRate: sample.yawRate });
  }

  for (const sample of mag) {
    if (
      !Number.isFinite(sample.t) ||
      !Number.isFinite(sample.x) ||
      !Number.isFinite(sample.y) ||
      !Number.isFinite(sample.z)
    ) {
      continue;
    }
    events.push({ t: sample.t, rank: 1, x: sample.x, y: sample.y, z: sample.z });
  }

  events.sort((a, b) => a.t - b.t || a.rank - b.rank);
  return events;
}

function step(
  state: FusionState,
  t: number,
  group: readonly TimedEvent[],
  config: HeadingFusionConfig,
): FusedHeading {
  if (state.lastT !== null && t > state.lastT) {
    const dtSeconds = (t - state.lastT) / 1000;
    state.heading = wrap360(state.heading + state.yawDegPerSec * dtSeconds);
  }
  state.lastT = t;

  let mag: MagEvent | undefined;
  for (const event of group) {
    if (event.rank === 0) state.yawDegPerSec = (event.yawRate * 180) / Math.PI;
    else mag = event;
  }

  let magneticHeading: number | null = null;
  let magnitudeUt: number | null = null;
  if (mag) {
    const reading = applyMagnetometer(state, t, mag, config);
    magneticHeading = reading.magneticHeading;
    magnitudeUt = reading.magnitudeUt;
  }

  return {
    t,
    heading: state.heading,
    gyroOnly: !state.hasFix || state.interfered,
    interference: state.interfered,
    magneticHeading,
    magnitudeUt,
  };
}

function applyMagnetometer(
  state: FusionState,
  t: number,
  mag: MagEvent,
  config: HeadingFusionConfig,
): { magneticHeading: number | null; magnitudeUt: number } {
  const magnitudeUt = magneticFieldMagnitude(mag.x, mag.y, mag.z);
  const horizontal = Math.hypot(mag.x, mag.y);
  const magneticHeading = horizontal > 0 ? magneticHeadingDeg(mag.x, mag.y) : null;
  const headingUsable =
    magneticHeading !== null &&
    horizontal >= config.minHorizontalUt &&
    Number.isFinite(magneticHeading);
  const magnitudeBad = magnitudeIsBad(magnitudeUt, state.baselineUt, config);

  if (!headingUsable) {
    if (magnitudeBad) latchInterference(state);
    else if (state.interfered) state.cleanSince = null;
    return { magneticHeading, magnitudeUt };
  }

  if (!state.hasFix) {
    if (!magnitudeBad) acquire(state, t, magneticHeading, magnitudeUt);
    else latchInterference(state);
    return { magneticHeading, magnitudeUt };
  }

  const innovation = wrap180(magneticHeading - state.heading);
  const innovationAbs = Math.abs(innovation);
  const sudden = isJump(state, magneticHeading, config) && innovationAbs > config.jumpThresholdDeg;
  const disagrees = innovationAbs > config.reacquireMaxDeg;

  if (magnitudeBad || sudden || disagrees) {
    latchInterference(state);
  } else if (state.interfered) {
    if (state.cleanSince === null) state.cleanSince = t;
    if (t - state.cleanSince >= config.recoverHoldMs) {
      state.interfered = false;
      state.cleanSince = null;
    }
  }

  if (!state.interfered && !magnitudeBad && !sudden) {
    correct(state, t, magneticHeading, magnitudeUt, innovation, config);
  }

  return { magneticHeading, magnitudeUt };
}

function acquire(
  state: FusionState,
  t: number,
  magneticHeading: number,
  magnitudeUt: number,
): void {
  state.heading = magneticHeading;
  state.hasFix = true;
  state.interfered = false;
  state.cleanSince = null;
  state.baselineUt = magnitudeUt;
  state.lastMagHeading = magneticHeading;
  state.headingMark = magneticHeading;
  state.lastTrustedT = t;
}

function correct(
  state: FusionState,
  t: number,
  magneticHeading: number,
  magnitudeUt: number,
  innovation: number,
  config: HeadingFusionConfig,
): void {
  const dtCorr = state.lastTrustedT === null ? 0 : (t - state.lastTrustedT) / 1000;
  const gain = blendAlpha(dtCorr, config.tauSeconds);
  state.heading = wrap360(state.heading + gain * innovation);

  if (state.baselineUt === null) state.baselineUt = magnitudeUt;
  else {
    const beta = blendAlpha(dtCorr, config.baselineTauSeconds);
    state.baselineUt += beta * (magnitudeUt - state.baselineUt);
  }

  state.lastTrustedT = t;
  state.lastMagHeading = magneticHeading;
  state.headingMark = state.heading;
}

/** Heading change the gyro did not explain, compared with the last trusted fix. */
function isJump(state: FusionState, magneticHeading: number, config: HeadingFusionConfig): boolean {
  if (state.lastMagHeading === null) return false;
  const magDelta = wrap180(magneticHeading - state.lastMagHeading);
  const gyroDelta = wrap180(state.heading - state.headingMark);
  return Math.abs(wrap180(magDelta - gyroDelta)) > config.jumpThresholdDeg;
}

function latchInterference(state: FusionState): void {
  state.interfered = true;
  state.cleanSince = null;
}

function magnitudeIsBad(
  magnitudeUt: number,
  baselineUt: number | null,
  config: HeadingFusionConfig,
): boolean {
  if (magnitudeUt < config.magnitudeMinUt || magnitudeUt > config.magnitudeMaxUt) return true;
  if (baselineUt === null) return false;
  const reference = Math.abs(baselineUt);
  if (reference === 0) return true;
  return Math.abs(magnitudeUt - baselineUt) / reference > config.magnitudeDeviation;
}

/** 1 − exp(−dt / τ). Zero when there is no elapsed time. */
function blendAlpha(dtSeconds: number, tauSeconds: number): number {
  if (!(dtSeconds > 0) || !(tauSeconds > 0)) return 0;
  return 1 - Math.exp(-dtSeconds / tauSeconds);
}

function wrap360(deg: number): number {
  const wrapped = ((deg % 360) + 360) % 360;
  return wrapped === 0 ? 0 : wrapped;
}

function wrap180(deg: number): number {
  const wrapped = wrap360(deg);
  return wrapped > 180 ? wrapped - 360 : wrapped;
}

function resolveConfig(config?: Partial<HeadingFusionConfig>): HeadingFusionConfig {
  const defaults = DEFAULT_HEADING_FUSION_CONFIG;
  const tauSeconds = positive(config?.tauSeconds, defaults.tauSeconds);
  const magnitudeMinUt = finiteOr(config?.magnitudeMinUt, defaults.magnitudeMinUt);
  const magnitudeMaxUt = finiteOr(config?.magnitudeMaxUt, defaults.magnitudeMaxUt);
  const window =
    magnitudeMinUt <= magnitudeMaxUt
      ? { magnitudeMinUt, magnitudeMaxUt }
      : { magnitudeMinUt: defaults.magnitudeMinUt, magnitudeMaxUt: defaults.magnitudeMaxUt };

  return {
    tauSeconds,
    ...window,
    magnitudeDeviation: nonNegative(config?.magnitudeDeviation, defaults.magnitudeDeviation),
    minHorizontalUt: nonNegative(config?.minHorizontalUt, defaults.minHorizontalUt),
    jumpThresholdDeg: nonNegative(config?.jumpThresholdDeg, defaults.jumpThresholdDeg),
    reacquireMaxDeg: nonNegative(config?.reacquireMaxDeg, defaults.reacquireMaxDeg),
    recoverHoldMs: nonNegative(config?.recoverHoldMs, defaults.recoverHoldMs),
    initialHeadingDeg: wrap360(finiteOr(config?.initialHeadingDeg, defaults.initialHeadingDeg)),
    baselineTauSeconds: positive(config?.baselineTauSeconds, defaults.baselineTauSeconds),
  };
}

function finiteOr(value: number | undefined, fallback: number): number {
  return value === undefined || !Number.isFinite(value) ? fallback : value;
}

function positive(value: number | undefined, fallback: number): number {
  const resolved = finiteOr(value, fallback);
  return resolved > 0 ? resolved : fallback;
}

function nonNegative(value: number | undefined, fallback: number): number {
  const resolved = finiteOr(value, fallback);
  return resolved >= 0 ? resolved : fallback;
}
