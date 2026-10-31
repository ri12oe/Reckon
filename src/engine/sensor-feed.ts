/**
 * Device-motion feed for the live dead-reckoning engine.
 *
 * Expo SDK 58 exposes the three motion sensors from `expo-sensors`
 * (`Accelerometer`, `Gyroscope`, `Magnetometer`). This module subscribes
 * to those and pushes engine-frame samples. It does not read `Pedometer`.
 * Step counts come from accelerometer peaks in the engine, not from the
 * platform step counter.
 *
 * Units, from the SDK 58 docs and the native modules:
 * - accelerometer: g-force (1 g = 9.80665 m/s²). Android divides by
 *   `SensorManager.GRAVITY_EARTH` before the event is delivered.
 * - gyroscope: radians per second
 * - magnetometer: microtesla
 * - `timestamp`: seconds. The engine clock is milliseconds, so timestamps
 *   are rounded to the nearest millisecond.
 *
 * Device axes, the pass-through frame (Android sensor coordinates, and the
 * usual phone frame): +x to the right, +y toward the top of the device,
 * +z out of the screen. The engine body frame is +x forward, +y right,
 * +z down, which for a portrait phone held screen-up is:
 *
 *   forward = device y, right = device x, down = −device z
 *
 * Gyroscope yaw is the rotation about that down axis. Right-hand rotation
 * about device +z (out of the screen, up) is counter-clockwise viewed from
 * above, so clockwise yaw is `−device.z`.
 *
 * iOS Core Motion, screen up and at rest, reports about −1 g on z rather
 * than Android's +1 g. Step detection uses the vector magnitude, so that
 * sign does not change the count. Heading uses the mapped axes above.
 *
 * Callers inject `sensors` in tests. The default loader is `expo-sensors`.
 */

import type { GyroSample, MagSample } from '@/engine/heading-fusion';
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
};

type FeedState = {
  stopped: boolean;
  subscriptions: SensorSubscription[];
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

  const feed: SensorFeed = {
    stop() {
      if (state.stopped) return;
      state.stopped = true;
      for (const subscription of state.subscriptions) subscription.remove();
      state.subscriptions.length = 0;
    },
  };

  await subscribe(sensors.Accelerometer, intervalMs, state, (measurement) => {
    const sample = accelFromDevice(measurement, nowMs);
    if (sample) sink.pushAccel(sample);
  });
  await subscribe(sensors.Gyroscope, intervalMs, state, (measurement) => {
    const sample = gyroFromDevice(measurement, nowMs);
    if (sample) sink.pushGyro(sample);
  });
  await subscribe(sensors.Magnetometer, intervalMs, state, (measurement) => {
    const sample = magFromDevice(measurement, nowMs);
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

function accelFromDevice(measurement: SensorMeasurement, nowMs: () => number): AccelSample | null {
  const t = timeMs(measurement, nowMs);
  if (t === null || !finiteAxes(measurement)) return null;
  return {
    t,
    x: measurement.y * STANDARD_GRAVITY_MPS2,
    y: measurement.x * STANDARD_GRAVITY_MPS2,
    z: -measurement.z * STANDARD_GRAVITY_MPS2,
  };
}

function gyroFromDevice(measurement: SensorMeasurement, nowMs: () => number): GyroSample | null {
  const t = timeMs(measurement, nowMs);
  if (t === null || !finiteAxes(measurement)) return null;
  return { t, yawRate: -measurement.z };
}

function magFromDevice(measurement: SensorMeasurement, nowMs: () => number): MagSample | null {
  const t = timeMs(measurement, nowMs);
  if (t === null || !finiteAxes(measurement)) return null;
  return {
    t,
    x: measurement.y,
    y: measurement.x,
    z: -measurement.z,
  };
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
