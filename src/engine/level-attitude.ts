/**
 * Level the gyroscope and the magnetometer with gravity.
 *
 * Device frame, shared by expo-sensors on iOS and Android (portrait):
 * +x to the right, +y toward the top of the phone, +z out of the screen.
 * Gyroscope and magnetometer use that frame on both platforms:
 * gyro is radians per second, right-handed about those axes;
 * magnetometer is the field vector in microtesla.
 *
 * The accelerometer does not. At rest, screen up:
 * - iOS `CMAccelerometerData` is the gravity vector, so z ≈ −1 g
 *   (world-down). `accelAtRest: 'down'`.
 * - Android `TYPE_ACCELEROMETER` is specific force, so z ≈ +1 g
 *   (world-up). Expo divides by `GRAVITY_EARTH` and keeps that sign.
 *   `accelAtRest: 'up'`.
 *
 * World-down in the device frame is the unit gravity vector after that
 * sign is applied. Screen up, it is (0, 0, −1) on both platforms: +z
 * points at the sky, so down is −z. That vector is the projection axis
 * for yaw. Clockwise from above is the right-handed rate about down,
 * which is the engine's positive heading change. Flat and screen up,
 * that rate is −gyro.z, the same value the feed used before leveling.
 *
 * Forward is device +y, the top of the phone. The tilt-compensated
 * magnetometer reading is the field expressed in the leveled engine
 * frame: horizontal forward, horizontal right, down. Heading fusion
 * already reads that frame (`magneticHeadingDeg`).
 *
 * Tracking pauses when device +y is more than
 * `LEVEL_MAX_TILT_FROM_HORIZONTAL_DEG` off the horizon. Past that the top
 * of the phone is close to vertical and a heading from it is mostly tilt
 * noise. The same test is applied to the low-passed gravity and to the
 * current sample, so a jolt that throws the acceleration vector over
 * pauses too.
 */

export type Vec3 = {
  x: number;
  y: number;
  z: number;
};

/** Which way a resting accelerometer points. See the file comment. */
export type AccelAtRest = 'down' | 'up';

/**
 * Tracking pauses when device +y, the top of the phone, is tilted more
 * than this many degrees off the horizon.
 *
 * 70° is still a steep portrait hold: the screen faces the walker and the
 * top points forward and up, so a heading exists. Past 70° the top is
 * within 20° of straight up or down and that heading is mostly tilt noise.
 * The same angle is applied to the current acceleration sample, so a jolt
 * that knocks the apparent gravity past 70° pauses too. A step along the
 * true vertical does not: it leaves the direction of gravity alone.
 */
export const LEVEL_MAX_TILT_FROM_HORIZONTAL_DEG = 70;

/**
 * Gravity low-pass time constant, seconds. Step impacts are a fraction of
 * a second and ride on top of gravity; this keeps the down vector on the
 * slow part of the acceleration.
 */
export const GRAVITY_LOWPASS_TAU_S = 0.4;

/** World-down when the screen faces up: device +z points at the sky. */
export const FLAT_SCREEN_UP_DOWN: Vec3 = { x: 0, y: 0, z: -1 };

/**
 * The gravity low-pass is trusted only while its magnitude stays within
 * 25% of 1 g. A fragment like 0.5 g is not a down vector, so the feed
 * keeps the screen-up assumption until a real gravity reading arrives.
 * Walking bumps stay inside the band: the 0.4 s low-pass peaks near 1.13 g
 * for the step detector's usual impacts.
 */
const GRAVITY_MAGNITUDE_TOLERANCE = 0.25;

/** True when a low-passed accelerometer vector is close enough to 1 g to be gravity. */
export function gravityLowpassUsable(accelG: Vec3): boolean {
  const magnitude = Math.hypot(accelG.x, accelG.y, accelG.z);
  return (
    magnitude >= 1 - GRAVITY_MAGNITUDE_TOLERANCE && magnitude <= 1 + GRAVITY_MAGNITUDE_TOLERANCE
  );
}

/** Unit world-down from one accelerometer sample, or null if it has no direction. */
export function worldDown(accelG: Vec3, atRest: AccelAtRest): Vec3 | null {
  const sign = atRest === 'up' ? -1 : 1;
  return unit({ x: sign * accelG.x, y: sign * accelG.y, z: sign * accelG.z });
}

/**
 * Low-pass `sample` into `previous`. The first sample snaps. A non-positive
 * `dtSeconds` keeps `previous` (duplicate or out-of-order time).
 */
export function smoothGravity(previous: Vec3 | null, sample: Vec3, dtSeconds: number): Vec3 {
  if (previous === null) return { x: sample.x, y: sample.y, z: sample.z };
  if (!(dtSeconds > 0)) return previous;
  const alpha = 1 - Math.exp(-dtSeconds / GRAVITY_LOWPASS_TAU_S);
  return {
    x: previous.x + alpha * (sample.x - previous.x),
    y: previous.y + alpha * (sample.y - previous.y),
    z: previous.z + alpha * (sample.z - previous.z),
  };
}

/**
 * Angle of device +y above or below the horizon, in degrees.
 * 0 is flat, 90 is the top of the phone straight up or down.
 */
export function tiltFromHorizontalDeg(down: Vec3): number {
  const d = unit(down);
  if (!d) return 90;
  const vertical = Math.min(1, Math.abs(d.y));
  return (Math.asin(vertical) * 180) / Math.PI;
}

/**
 * True when the smoothed pose and this sample's acceleration both keep
 * device +y within `LEVEL_MAX_TILT_FROM_HORIZONTAL_DEG` of the horizon.
 */
export function attitudeIsLevel(down: Vec3, instantDown: Vec3): boolean {
  return (
    tiltFromHorizontalDeg(down) <= LEVEL_MAX_TILT_FROM_HORIZONTAL_DEG &&
    tiltFromHorizontalDeg(instantDown) <= LEVEL_MAX_TILT_FROM_HORIZONTAL_DEG
  );
}

/**
 * Clockwise yaw rate, radians per second: the gyro dotted with world-down.
 * Null when `down` has no direction.
 */
export function yawAboutDown(gyro: Vec3, down: Vec3): number | null {
  const d = unit(down);
  if (!d) return null;
  return gyro.x * d.x + gyro.y * d.y + gyro.z * d.z;
}

/**
 * Magnetometer in the leveled engine frame (+x horizontal forward, +y
 * horizontal right, +z down), microtesla. Null when device +y is too
 * close to vertical to name forward.
 */
export function levelMagnetometer(mag: Vec3, down: Vec3): Vec3 | null {
  const d = unit(down);
  if (!d) return null;
  const vertical = d.y;
  const forward = unit({
    x: -d.x * vertical,
    y: 1 - d.y * vertical,
    z: -d.z * vertical,
  });
  if (!forward || tiltFromHorizontalDeg(d) > LEVEL_MAX_TILT_FROM_HORIZONTAL_DEG) return null;
  const right = {
    x: d.y * forward.z - d.z * forward.y,
    y: d.z * forward.x - d.x * forward.z,
    z: d.x * forward.y - d.y * forward.x,
  };
  return {
    x: mag.x * forward.x + mag.y * forward.y + mag.z * forward.z,
    y: mag.x * right.x + mag.y * right.y + mag.z * right.z,
    z: mag.x * d.x + mag.y * d.y + mag.z * d.z,
  };
}

function unit(v: Vec3): Vec3 | null {
  const n = Math.hypot(v.x, v.y, v.z);
  if (!(n > 0) || !Number.isFinite(n)) return null;
  return { x: v.x / n, y: v.y / n, z: v.z / n };
}
