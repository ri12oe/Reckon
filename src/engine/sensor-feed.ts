/**
 * Device-motion feed for the live dead-reckoning engine.
 *
 * Expo SDK 58 exposes the three motion sensors from `expo-sensors`
 * (`Accelerometer`, `Gyroscope`, `Magnetometer`). This module subscribes
 * to those and pushes engine-frame samples. It does not read `Pedometer`.
 * Step counts come from accelerometer peaks in the engine, not from the
 * platform step counter. `DeviceMotion` is not used; gravity is a low-pass
 * of the accelerometer, which is already subscribed for steps.
 *
 * Units, from the SDK 58 docs and the native modules:
 * - accelerometer: g-force (1 g = 9.80665 m/s²). Android divides by
 *   `SensorManager.GRAVITY_EARTH` before the event is delivered.
 * - gyroscope: radians per second
 * - magnetometer: microtesla
 * - `timestamp`: seconds. The engine clock is milliseconds, so timestamps
 *   are rounded to the nearest millisecond.
 *
 * Device axes (Android sensor coordinates and the iOS device frame):
 * +x to the right, +y toward the top of the device, +z out of the screen.
 * The engine body frame is +x forward, +y right, +z down.
 *
 * Accelerometer samples keep a fixed relabel into that body frame
 * (`forward = device y`, `right = device x`, `down = −device z`). Step
 * detection uses the magnitude, so the relabel does not have to follow
 * the phone's tilt. iOS Core Motion, screen up and at rest, reports about
 * −1 g on z rather than Android's +1 g.
 *
 * Gyroscope yaw and the magnetometer heading do follow the tilt. A
 * low-pass of the accelerometer estimates gravity; world-down is that
 * vector (negated on Android, where the accelerometer reads specific
 * force). Yaw rate is the gyro dotted with world-down, which is clockwise
 * positive and equals `−device.z` when the screen is up. The magnetometer
 * is projected onto the horizontal plane with that same down and with
 * device +y as forward. See `level-attitude.ts`.
 *
 * When the top of the phone, or the current sample's acceleration, is
 * past `LEVEL_MAX_TILT_FROM_HORIZONTAL_DEG` (70° off the horizon), the
 * feed pauses and pushes no accel, no gyro, and no mag.
 * Tracking resumes once the pose is usable again. Until the first
 * accelerometer sample, the phone is assumed screen-up.
 *
 * Callers inject `sensors` in tests. The default loader is `expo-sensors`.
 */

import type { GyroSample, MagSample } from '@/engine/heading-fusion';
import {
  attitudeIsLevel,
  FLAT_SCREEN_UP_DOWN,
  gravityLowpassUsable,
  levelMagnetometer,
  smoothGravity,
  worldDown,
  yawAboutDown,
  type AccelAtRest,
  type Vec3,
} from '@/engine/level-attitude';
import { STANDARD_GRAVITY_MPS2, type AccelSample } from '@/engine/step-detector';

/** 50 Hz. Matches the step detector's sample clock and stays under Android's 200 Hz cap. */
export const DEFAULT_SENSOR_UPDATE_INTERVAL_MS = 20;

export type SensorMeasurement = {
  x: number;
  y: number;
  z: number;
  /** Seconds, the Expo sensor clock. Omitted or non-finite falls back to `nowMs`. */
  timestamp?: number;
};

export type SensorSubscription = {
  remove(): void;
};

export type SensorPermission = {
  granted?: boolean;
};

/** Structural slice of an Expo SDK 58 `DeviceSensor`. */
export type MotionSensor = {
  addListener(listener: (measurement: SensorMeasurement) => void): SensorSubscription;
  setUpdateInterval(intervalMs: number): void;
  isAvailableAsync?(): Promise<boolean>;
  requestPermissionsAsync?(): Promise<SensorPermission>;
};

export type MotionSensors = {
  Accelerometer: MotionSensor;
  Gyroscope: MotionSensor;
  Magnetometer: MotionSensor;
};

export type SensorFeedSink = {
  pushAccel(sample: AccelSample): void;
  pushGyro(sample: GyroSample): void;
  pushMag(sample: MagSample): void;
};

export type SensorFeed = {
  stop(): void;
};

export type StartSensorFeedOptions = {
  /** Defaults to Accelerometer, Gyroscope, and Magnetometer from `expo-sensors`. */
  sensors?: MotionSensors;
  /** Milliseconds between updates on each sensor. Non-positive values use the default. */
  updateIntervalMs?: number;
  /** Millisecond clock used when a measurement has no finite timestamp. */
  nowMs?: () => number;
  /**
   * Resting accelerometer direction. `'down'` is iOS Core Motion
   * (screen up → z ≈ −1). `'up'` is Android `TYPE_ACCELEROMETER`
   * (screen up → z ≈ +1). Omitted follows `Platform.OS`.
   */
  accelAtRest?: AccelAtRest;
};

type FeedState = {
  stopped: boolean;
  subscriptions: SensorSubscription[];
};

type AttitudeTracker = {
  atRest: AccelAtRest;
  gravity: Vec3 | null;
  gravityT: number | null;
  /** Latest world-down. Null until the first accelerometer sample. */
  down: Vec3 | null;
  /** False while the pose is past `LEVEL_MAX_TILT_FROM_HORIZONTAL_DEG`. */
  level: boolean;
};

export function loadExpoMotionSensors(): MotionSensors {
  // Static `import` would load the native module for every engine test.
  // `require` stays lazy and is what Jest replaces when the module is mocked.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const sensors = require('expo-sensors') as typeof import('expo-sensors');
  const { Accelerometer, Gyroscope, Magnetometer } = sensors;
  if (!Accelerometer || !Gyroscope || !Magnetometer) {
    throw new Error('expo-sensors is missing Accelerometer, Gyroscope, or Magnetometer');
  }
  return { Accelerometer, Gyroscope, Magnetometer };
}

export async function startSensorFeed(
  sink: SensorFeedSink,
  options?: StartSensorFeedOptions,
): Promise<SensorFeed> {
  const sensors = options?.sensors ?? loadExpoMotionSensors();
  const intervalMs = resolveInterval(options?.updateIntervalMs);
  const nowMs = options?.nowMs ?? (() => Date.now());
  const state: FeedState = { stopped: false, subscriptions: [] };
  const attitude = createAttitudeTracker(resolveAccelAtRest(options?.accelAtRest));

  const feed: SensorFeed = {
    stop() {
      if (state.stopped) return;
      state.stopped = true;
      for (const subscription of state.subscriptions) subscription.remove();
      state.subscriptions.length = 0;
    },
  };

  await subscribe(sensors.Accelerometer, intervalMs, state, (measurement) => {
    const observed = observeAccel(attitude, measurement, nowMs);
    if (!observed) return;
    if (observed.hold) sink.pushGyro(observed.hold);
    if (observed.accel) sink.pushAccel(observed.accel);
  });
  await subscribe(sensors.Gyroscope, intervalMs, state, (measurement) => {
    const sample = gyroFromDevice(attitude, measurement, nowMs);
    if (sample) sink.pushGyro(sample);
  });
  await subscribe(sensors.Magnetometer, intervalMs, state, (measurement) => {
    const sample = magFromDevice(attitude, measurement, nowMs);
    if (sample) sink.pushMag(sample);
  });

  return feed;
}

async function subscribe(
  sensor: MotionSensor,
  intervalMs: number,
  state: FeedState,
  onSample: (measurement: SensorMeasurement) => void,
): Promise<void> {
  if (state.stopped) return;
  try {
    if (sensor.requestPermissionsAsync) {
      const permission = await sensor.requestPermissionsAsync();
      if (state.stopped) return;
      if (permission?.granted === false) return;
    }
    if (sensor.isAvailableAsync) {
      const available = await sensor.isAvailableAsync();
      if (state.stopped) return;
      if (!available) return;
    }
  } catch {
    return;
  }
  if (state.stopped) return;

  sensor.setUpdateInterval(intervalMs);
  const subscription = sensor.addListener((measurement) => {
    if (state.stopped || measurement == null) return;
    onSample(measurement);
  });
  state.subscriptions.push(subscription);
}

function createAttitudeTracker(atRest: AccelAtRest): AttitudeTracker {
  return { atRest, gravity: null, gravityT: null, down: null, level: true };
}

function observeAccel(
  tracker: AttitudeTracker,
  measurement: SensorMeasurement,
  nowMs: () => number,
): { accel: AccelSample | null; hold: GyroSample | null } | null {
  const t = timeMs(measurement, nowMs);
  if (t === null || !finiteAxes(measurement)) return null;

  const reading = { x: measurement.x, y: measurement.y, z: measurement.z };
  const dt = tracker.gravityT === null ? Number.POSITIVE_INFINITY : (t - tracker.gravityT) / 1000;
  const next = smoothGravity(tracker.gravity, reading, dt);
  if (next !== tracker.gravity) {
    tracker.gravity = next;
    tracker.gravityT = t;
  }

  if (tracker.gravity && gravityLowpassUsable(tracker.gravity)) {
    tracker.down = worldDown(tracker.gravity, tracker.atRest);
  }
  const instant = worldDown(reading, tracker.atRest);
  // No trusted gravity yet: assume the screen is up and still forward
  // the accelerometer. A short or non-gravity sample must not tilt yaw.
  if (tracker.down === null) {
    tracker.level = true;
    return { accel: accelFromDevice(measurement, t), hold: null };
  }
  // Free-fall and any other reading with no direction cannot be a step
  // or a heading fix.
  if (instant === null) {
    const hold = tracker.level ? yawBrake(t) : null;
    tracker.level = false;
    return { accel: null, hold };
  }
  const level = attitudeIsLevel(tracker.down, instant);
  const hold = tracker.level && !level ? yawBrake(t) : null;
  tracker.level = level;
  if (!level) return { accel: null, hold };
  return { accel: accelFromDevice(measurement, t), hold };
}

function yawBrake(t: number): GyroSample {
  return { t, brake: true };
}

function accelFromDevice(measurement: SensorMeasurement, t: number): AccelSample {
  return {
    t,
    x: measurement.y * STANDARD_GRAVITY_MPS2,
    y: measurement.x * STANDARD_GRAVITY_MPS2,
    z: -measurement.z * STANDARD_GRAVITY_MPS2,
  };
}

function gyroFromDevice(
  tracker: AttitudeTracker,
  measurement: SensorMeasurement,
  nowMs: () => number,
): GyroSample | null {
  const t = timeMs(measurement, nowMs);
  if (t === null || !finiteAxes(measurement) || !tracker.level) return null;
  const yawRate = yawAboutDown(measurement, tracker.down ?? FLAT_SCREEN_UP_DOWN);
  if (yawRate === null || !Number.isFinite(yawRate)) return null;
  return { t, yawRate };
}

function magFromDevice(
  tracker: AttitudeTracker,
  measurement: SensorMeasurement,
  nowMs: () => number,
): MagSample | null {
  const t = timeMs(measurement, nowMs);
  if (t === null || !finiteAxes(measurement) || !tracker.level) return null;
  const leveled = levelMagnetometer(measurement, tracker.down ?? FLAT_SCREEN_UP_DOWN);
  if (!leveled) return null;
  return { t, x: leveled.x, y: leveled.y, z: leveled.z };
}

function resolveAccelAtRest(value: AccelAtRest | undefined): AccelAtRest {
  if (value === 'down' || value === 'up') return value;
  return platformAccelAtRest();
}

function platformAccelAtRest(): AccelAtRest {
  // Same lazy require as `expo-sensors`: engine tests must not load native
  // modules until a feed actually starts, and Jest supplies the Platform mock.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Platform } = require('react-native') as typeof import('react-native');
  return Platform.OS === 'android' ? 'up' : 'down';
}

function timeMs(measurement: SensorMeasurement, nowMs: () => number): number | null {
  if (Number.isFinite(measurement.timestamp)) return Math.round(measurement.timestamp! * 1000);
  const now = nowMs();
  return Number.isFinite(now) ? Math.round(now) : null;
}

function finiteAxes(measurement: SensorMeasurement): boolean {
  return (
    Number.isFinite(measurement.x) &&
    Number.isFinite(measurement.y) &&
    Number.isFinite(measurement.z)
  );
}

function resolveInterval(intervalMs: number | undefined): number {
  if (intervalMs === undefined || !Number.isFinite(intervalMs) || intervalMs <= 0) {
    return DEFAULT_SENSOR_UPDATE_INTERVAL_MS;
  }
  return intervalMs;
}
