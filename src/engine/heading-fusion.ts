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
 *    until a magnetometer window of `recoverHoldMs` is clean and stable.
 *
 * Interference is a bad magnitude, or a jump or a disagreement with the
 * gyro while that window is not ready. The window is a property of the
 * magnetometer: every kept sample is magnitude-clean and within
 * `jumpThresholdDeg` of the newest heading. Gyro disagreement cannot
 * veto it. A ready window leaves the hold and blends, even when the
 * compass still disagrees with the gyro by more than `reacquireMaxDeg`.
 *
 * The first in-range magnetometer sample snaps the heading. The recovery
 * hold applies only after that fix has been lost.
 *
 * Device frame: +x forward, +y right, +z down, microtesla.
 * `yawRate` is radians per second, positive clockwise.
 * Streams may be unsynchronized; both are sorted by timestamp.
 *
 * Gyro rate is zero-order held: the rate on a sample applies until the
 * next gyroscope sample. A brake is not a measured yaw of 0: the following
 * gap integrates 0 and the brake is not a bias sample. At a shared
 * timestamp the gyro is integrated first, then the magnetometer may correct.
 *
 * Not in this module: step length, path integration, loop-closure drift.
 */

/** Radians per second, clockwise, the device measurement. */
export type YawMeasurement = {
  /** Milliseconds. */
  t: number;
  /** Radians per second, positive clockwise (same sense as heading). */
  yawRate: number;
};

/** Tilt pause. The following gap integrates 0 and is not a bias sample. */
export type YawBrake = {
  /** Milliseconds. */
  t: number;
  brake: true;
};

export type GyroSample = YawMeasurement | YawBrake;

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
   * While the recovery window is not ready, a magnetometer heading farther
   * than this from the fused heading is not trusted.
   */
  reacquireMaxDeg: number;
  /** Milliseconds of clean, stable magnetometer samples required to leave a hold. */
  recoverHoldMs: number;
  /** Heading used until the first trusted magnetometer sample, degrees. */
  initialHeadingDeg: number;
  /** Time constant for the trusted magnitude baseline, seconds. */
  baselineTauSeconds: number;
  /** Low-pass time constant for gyro bias, seconds. */
  biasTauSeconds: number;
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
  biasTauSeconds: 5,
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

type YawEvent =
  { t: number; rank: 0; kind: 'measured'; yawRate: number } | { t: number; rank: 0; kind: 'brake' };
type MagEvent = { t: number; rank: 1; x: number; y: number; z: number };
type TimedEvent = YawEvent | MagEvent;

/** What the zero-order hold is carrying. A brake is not a measured 0. */
type HeldYaw = { kind: 'brake' } | { kind: 'measured'; degPerSec: number };

type Phase = { kind: 'open' } | { kind: 'rejected' } | { kind: 'live' } | { kind: 'held' };

type MagObs = {
  t: number;
  magnitudeUt: number;
  /** Null when the horizontal field does not define a heading. */
  headingDeg: number | null;
};

type FusionState = {
  heading: number;
  yaw: HeldYaw;
  /** Clockwise degrees per second subtracted from a measured yaw rate. */
  biasDegPerSec: number;
  /** Raw degrees integrated since the last live correction. Discarded on latch. */
  rawYawAccumDeg: number;
  lastT: number | null;
  phase: Phase;
  baselineUt: number | null;
  lastMagHeading: number | null;
  headingMark: number;
  lastTrustedT: number | null;
  /** Samples with t >= now - recoverHoldMs, oldest first. */
  recentMag: MagObs[];
};

function createState(initialHeadingDeg: number): FusionState {
  const heading = wrap360(initialHeadingDeg);
  return {
    heading,
    yaw: { kind: 'measured', degPerSec: 0 },
    biasDegPerSec: 0,
    rawYawAccumDeg: 0,
    lastT: null,
    phase: { kind: 'open' },
    baselineUt: null,
    lastMagHeading: null,
    headingMark: heading,
    lastTrustedT: null,
    recentMag: [],
  };
}

function collectEvents(gyro: readonly GyroSample[], mag: readonly MagSample[]): TimedEvent[] {
  const events: TimedEvent[] = [];

  for (const sample of gyro) {
    if (!Number.isFinite(sample.t)) continue;
    if ('brake' in sample) {
      events.push({ t: sample.t, rank: 0, kind: 'brake' });
      continue;
    }
    if (!Number.isFinite(sample.yawRate)) continue;
    events.push({ t: sample.t, rank: 0, kind: 'measured', yawRate: sample.yawRate });
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
    state.heading = wrap360(
      state.heading + appliedYawDegPerSec(state.yaw, state.biasDegPerSec) * dtSeconds,
    );
    if (state.phase.kind === 'live' && state.yaw.kind === 'measured') {
      state.rawYawAccumDeg += state.yaw.degPerSec * dtSeconds;
    }
  }
  state.lastT = t;

  let mag: MagEvent | undefined;
  for (const event of group) {
    if (event.rank !== 0) {
      mag = event;
      continue;
    }
    state.yaw =
      event.kind === 'brake'
        ? { kind: 'brake' }
        : { kind: 'measured', degPerSec: (event.yawRate * 180) / Math.PI };
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
    gyroOnly: state.phase.kind !== 'live',
    interference: state.phase.kind === 'held' || state.phase.kind === 'rejected',
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

  state.recentMag.push({
    t,
    magnitudeUt,
    headingDeg: headingUsable ? magneticHeading : null,
  });
  // Keep t >= now - recoverHoldMs. The sample exactly one hold ago stays,
  // so the pre-jump heading still blocks release on the tick before it ages out.
  const oldest = t - config.recoverHoldMs;
  while (state.recentMag.length > 0 && state.recentMag[0]!.t < oldest) {
    state.recentMag.shift();
  }

  const magnitudeBad = magnitudeIsBad(magnitudeUt, state.baselineUt, config);

  if (!headingUsable) {
    if (magnitudeBad) latch(state);
    return { magneticHeading, magnitudeUt };
  }

  if (state.phase.kind === 'open' || state.phase.kind === 'rejected') {
    if (!magnitudeBad) acquire(state, t, magneticHeading, magnitudeUt);
    else state.phase = { kind: 'rejected' };
    return { magneticHeading, magnitudeUt };
  }

  if (recoveryReady(state.recentMag, state.baselineUt, config)) {
    const wasLive = state.phase.kind === 'live';
    state.phase = { kind: 'live' };
    if (wasLive) learnBias(state, t, magneticHeading, config);
    const innovation = wrap180(magneticHeading - state.heading);
    correct(state, t, magneticHeading, magnitudeUt, innovation, config);
    return { magneticHeading, magnitudeUt };
  }

  const innovation = wrap180(magneticHeading - state.heading);
  const innovationAbs = Math.abs(innovation);
  const sudden = isJump(state, magneticHeading, config) && innovationAbs > config.jumpThresholdDeg;
  const disagrees = innovationAbs > config.reacquireMaxDeg;

  if (magnitudeBad || sudden || disagrees) {
    if (state.phase.kind === 'live') {
      state.phase = { kind: 'held' };
      state.rawYawAccumDeg = 0;
    }
    return { magneticHeading, magnitudeUt };
  }

  if (state.phase.kind === 'live') {
    learnBias(state, t, magneticHeading, config);
    correct(state, t, magneticHeading, magnitudeUt, innovation, config);
  }

  return { magneticHeading, magnitudeUt };
}

function recoveryReady(
  recentMag: readonly MagObs[],
  baselineUt: number | null,
  config: HeadingFusionConfig,
): boolean {
  const first = recentMag[0];
  const last = recentMag[recentMag.length - 1];
  if (!first || !last || last.headingDeg === null) return false;
  if (last.t - first.t < config.recoverHoldMs) return false;

  for (const obs of recentMag) {
    if (obs.headingDeg === null) return false;
    if (Math.abs(wrap180(obs.headingDeg - last.headingDeg)) > config.jumpThresholdDeg) return false;
    if (magnitudeIsBad(obs.magnitudeUt, baselineUt, config)) return false;
  }
  return true;
}

function acquire(
  state: FusionState,
  t: number,
  magneticHeading: number,
  magnitudeUt: number,
): void {
  state.heading = magneticHeading;
  state.phase = { kind: 'live' };
  state.rawYawAccumDeg = 0;
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

/** Faster compass motion is a step or a wobble, not a bias sample. Degrees per second. */
const MAX_BIAS_COMPASS_RATE_DEG_PER_SEC = 30;

function appliedYawDegPerSec(yaw: HeldYaw, biasDegPerSec: number): number {
  if (yaw.kind === 'brake') return 0;
  return yaw.degPerSec - biasDegPerSec;
}

function latch(state: FusionState): void {
  if (state.phase.kind === 'live' || state.phase.kind === 'held') {
    state.phase = { kind: 'held' };
    state.rawYawAccumDeg = 0;
    return;
  }
  state.phase = { kind: 'rejected' };
}

function learnBias(
  state: FusionState,
  t: number,
  magneticHeading: number,
  config: HeadingFusionConfig,
): void {
  if (state.lastTrustedT === null || state.lastMagHeading === null) return;
  const dt = (t - state.lastTrustedT) / 1000;
  if (!(dt > 0)) return;
  const compassDelta = wrap180(magneticHeading - state.lastMagHeading);
  if (Math.abs(compassDelta) / dt > MAX_BIAS_COMPASS_RATE_DEG_PER_SEC) {
    state.rawYawAccumDeg = 0;
    return;
  }
  const compassRate = compassDelta / dt;
  const biasObs = state.rawYawAccumDeg / dt - compassRate;
  state.biasDegPerSec += blendAlpha(dt, config.biasTauSeconds) * (biasObs - state.biasDegPerSec);
  state.rawYawAccumDeg = 0;
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
    biasTauSeconds: positive(config?.biasTauSeconds, defaults.biasTauSeconds),
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
