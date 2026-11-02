import { Pedometer } from 'expo-sensors';

import {
  createLiveEngine,
  DEFAULT_SENSOR_UPDATE_INTERVAL_MS,
  getEngine,
  getLiveEngine,
  mockEngine,
  STANDARD_GRAVITY_MPS2,
  startSensors,
  stopSensors,
  sensorStartResult,
  startSensorFeed,
  type EngineSnapshot,
  type GyroSample,
  type MotionSensor,
  type MotionSensors,
  type SensorMeasurement,
} from '@/engine';

jest.mock('expo-sensors', () => {
  function sensor() {
    return {
      addListener: jest.fn(() => ({ remove: jest.fn() })),
      setUpdateInterval: jest.fn(),
      isAvailableAsync: jest.fn(async () => true),
      requestPermissionsAsync: jest.fn(async () => ({ granted: true, status: 'granted' })),
    };
  }
  return {
    Accelerometer: sensor(),
    Gyroscope: sensor(),
    Magnetometer: sensor(),
    Pedometer: {
      watchStepCount: jest.fn(),
      getStepCountAsync: jest.fn(),
    },
  };
});

const G = STANDARD_GRAVITY_MPS2;
const DT_MS = 20;

function hannBump(t: number, center: number, amplitude: number, halfWidthMs: number): number {
  const dt = t - center;
  if (Math.abs(dt) > halfWidthMs) return 0;
  return amplitude * 0.5 * (1 + Math.cos((Math.PI * dt) / halfWidthMs));
}

/** Engine-frame vertical steps: gravity on +z, Hann impacts along +z. Heading stays north. */
function engineVerticalWalk(peakTimes: number[], amplitude: number, halfWidthMs: number) {
  const end = (peakTimes[peakTimes.length - 1] ?? 0) + halfWidthMs + 200;
  const samples: { t: number; x: number; y: number; z: number }[] = [];
  for (let t = 0; t <= end; t += DT_MS) {
    let bump = 0;
    for (const center of peakTimes) bump += hannBump(t, center, amplitude, halfWidthMs);
    samples.push({ t, x: 0, y: 0, z: G + bump });
  }
  return samples;
}

/**
 * The same walk as Expo would report it: g-force, timestamp in seconds,
 * device +z out of the screen. At rest that is +1 g, which the adapter
 * maps to engine down.
 */
function deviceVerticalWalk(
  peakTimes: number[],
  amplitude: number,
  halfWidthMs: number,
): SensorMeasurement[] {
  return engineVerticalWalk(peakTimes, amplitude, halfWidthMs).map((sample) => ({
    x: 0,
    y: 0,
    z: -(sample.z / G),
    timestamp: sample.t / 1000,
  }));
}

type FakeSensor = MotionSensor & {
  addListener: jest.Mock;
  setUpdateInterval: jest.Mock;
  isAvailableAsync: jest.Mock;
  requestPermissionsAsync: jest.Mock;
  emit: (measurement: SensorMeasurement) => void;
};

function fakeSensor(options?: {
  available?: boolean;
  granted?: boolean;
  failAvailable?: boolean;
  failListen?: boolean;
}): FakeSensor {
  let listener: ((measurement: SensorMeasurement) => void) | null = null;
  return {
    addListener: jest.fn((fn: (measurement: SensorMeasurement) => void) => {
      if (options?.failListen) throw new Error('expo start failed');
      listener = fn;
      return {
        remove: jest.fn(() => {
          listener = null;
        }),
      };
    }),
    setUpdateInterval: jest.fn(),
    isAvailableAsync: jest.fn(async () => {
      if (options?.failAvailable) throw new Error('sensor unavailable');
      return options?.available ?? true;
    }),
    requestPermissionsAsync: jest.fn(async () => ({ granted: options?.granted ?? true })),
    emit(measurement) {
      listener?.(measurement);
    },
  };
}

function motionSensors(over: Partial<Record<keyof MotionSensors, FakeSensor>> = {}): {
  Accelerometer: FakeSensor;
  Gyroscope: FakeSensor;
  Magnetometer: FakeSensor;
} {
  return {
    Accelerometer: over.Accelerometer ?? fakeSensor(),
    Gyroscope: over.Gyroscope ?? fakeSensor(),
    Magnetometer: over.Magnetometer ?? fakeSensor(),
  };
}

const PLANTED = [500, 1000, 1500, 2000];

describe('sensorStartResult', () => {
  test('one subscribed sensor is not a start', () => {
    expect(
      sensorStartResult({
        accelerometer: 'subscribed',
        gyroscope: 'permission',
        magnetometer: 'subscribed',
      }),
    ).toEqual({
      ok: false,
      reason: 'permission',
    });
    expect(
      sensorStartResult({
        accelerometer: 'unavailable',
        gyroscope: 'subscribed',
        magnetometer: 'subscribed',
      }),
    ).toEqual({
      ok: false,
      reason: 'unavailable',
    });
    expect(
      sensorStartResult({
        accelerometer: 'subscribed',
        gyroscope: 'unavailable',
        magnetometer: 'permission',
      }),
    ).toEqual({
      ok: false,
      reason: 'unavailable',
    });
    expect(
      sensorStartResult({
        accelerometer: 'error',
        gyroscope: 'subscribed',
        magnetometer: 'permission',
      }),
    ).toEqual({
      ok: false,
      reason: 'error',
    });
    expect(
      sensorStartResult({
        accelerometer: 'subscribed',
        gyroscope: 'stopped',
        magnetometer: 'stopped',
      }),
    ).toEqual({
      ok: false,
      reason: 'cancelled',
    });
  });

  test('accelerometer and gyroscope together start, even when the magnetometer does not', () => {
    expect(
      sensorStartResult({
        accelerometer: 'subscribed',
        gyroscope: 'subscribed',
        magnetometer: 'unavailable',
      }),
    ).toEqual({ ok: true });
    expect(
      sensorStartResult({
        accelerometer: 'subscribed',
        gyroscope: 'subscribed',
        magnetometer: 'permission',
      }),
    ).toEqual({ ok: true });
    expect(
      sensorStartResult({
        accelerometer: 'subscribed',
        gyroscope: 'subscribed',
        magnetometer: 'error',
      }),
    ).toEqual({ ok: true });
    expect(
      sensorStartResult({
        accelerometer: 'subscribed',
        gyroscope: 'subscribed',
        magnetometer: 'stopped',
      }),
    ).toEqual({ ok: true });
  });

  test('a miss on both required sensors prefers permission, then error', () => {
    expect(
      sensorStartResult({
        accelerometer: 'permission',
        gyroscope: 'unavailable',
        magnetometer: 'error',
      }),
    ).toEqual({
      ok: false,
      reason: 'permission',
    });
    expect(
      sensorStartResult({
        accelerometer: 'stopped',
        gyroscope: 'error',
        magnetometer: 'unavailable',
      }),
    ).toEqual({
      ok: false,
      reason: 'error',
    });
    expect(
      sensorStartResult({
        accelerometer: 'unavailable',
        gyroscope: 'unavailable',
        magnetometer: 'error',
      }),
    ).toEqual({
      ok: false,
      reason: 'unavailable',
    });
    expect(
      sensorStartResult({
        accelerometer: 'stopped',
        gyroscope: 'stopped',
        magnetometer: 'stopped',
      }),
    ).toEqual({ ok: false, reason: 'cancelled' });
  });
});

describe('sensor frame conversion', () => {
  test('maps g, rad/s, and µT into engine samples with millisecond timestamps', async () => {
    const sensors = motionSensors();
    const accel: { t: number; x: number; y: number; z: number }[] = [];
    const gyro: GyroSample[] = [];
    const mag: { t: number; x: number; y: number; z: number }[] = [];
    const feed = await startSensorFeed(
      {
        pushAccel: (sample) => accel.push(sample),
        pushGyro: (sample) => gyro.push(sample),
        pushMag: (sample) => mag.push(sample),
      },
      { sensors },
    );

    sensors.Accelerometer.emit({ x: 0.5, y: -0.25, z: 0.125, timestamp: 1.5 });
    sensors.Gyroscope.emit({ x: 0.2, y: -0.4, z: -1.25, timestamp: 2.25 });
    sensors.Magnetometer.emit({ x: -30, y: 12, z: -40, timestamp: 0.4 });

    expect(accel).toEqual([
      {
        t: 1500,
        x: -0.25 * G,
        y: 0.5 * G,
        z: -0.125 * G,
      },
    ]);
    expect(gyro).toEqual([{ t: 2250, yawRate: 1.25 }]);
    expect(mag).toEqual([{ t: 400, x: 12, y: -30, z: 40, levelReady: false }]);
    feed.stop();
  });

  test('a non-finite axis is dropped, and a missing timestamp uses nowMs', async () => {
    const sensors = motionSensors();
    const accel: { t: number }[] = [];
    const feed = await startSensorFeed(
      {
        pushAccel: (sample) => accel.push(sample),
        pushGyro: () => undefined,
        pushMag: () => undefined,
      },
      { sensors, nowMs: () => 42 },
    );

    sensors.Accelerometer.emit({ x: Number.NaN, y: 0, z: 1, timestamp: 1 });
    sensors.Accelerometer.emit({ x: 0, y: 0, z: 1, timestamp: Number.NaN });

    expect(accel).toEqual([{ t: 42, x: 0, y: 0, z: -G }]);
    feed.stop();
  });

  test('a missing timestamp stays on the sensor millisecond clock', async () => {
    const sensors = motionSensors();
    const accel: { t: number }[] = [];
    let wall = 1_762_000_000_000;
    const feed = await startSensorFeed(
      {
        pushAccel: (sample) => accel.push(sample),
        pushGyro: () => undefined,
        pushMag: () => undefined,
      },
      { sensors, nowMs: () => wall },
    );

    sensors.Accelerometer.emit({ x: 0, y: 0, z: 1, timestamp: 10 });
    wall += 20;
    sensors.Accelerometer.emit({ x: 0, y: 0, z: 1 });

    const dt = accel[1]!.t - accel[0]!.t;
    const alpha = 1 - Math.exp(-dt / 1000 / 0.4);
    expect({ dt, alpha }).toEqual({ dt: 20, alpha: expect.closeTo(1 - Math.exp(-0.05), 12) });
    feed.stop();
  });

  test('millisecond sensor timestamps are not scaled a second time', async () => {
    const sensors = motionSensors();
    const accel: { t: number }[] = [];
    const feed = await startSensorFeed(
      {
        pushAccel: (sample) => accel.push(sample),
        pushGyro: () => undefined,
        pushMag: () => undefined,
      },
      { sensors, nowMs: () => 0 },
    );

    sensors.Accelerometer.emit({ x: 0, y: 0, z: 1, timestamp: 10_000 });
    sensors.Accelerometer.emit({ x: 0, y: 0, z: 1, timestamp: 10_020 });

    const dt = accel[1]!.t - accel[0]!.t;
    expect(dt).toBe(20);
    feed.stop();
  });

  test('a wall-clock sample followed by sensor seconds stays on one clock', async () => {
    const sensors = motionSensors();
    const accel: { t: number }[] = [];
    let wall = 1_762_000_000_000;
    const feed = await startSensorFeed(
      {
        pushAccel: (sample) => accel.push(sample),
        pushGyro: () => undefined,
        pushMag: () => undefined,
      },
      { sensors, nowMs: () => wall },
    );

    sensors.Accelerometer.emit({ x: 0, y: 0, z: 1 });
    wall += 20;
    sensors.Accelerometer.emit({ x: 0, y: 0, z: 1, timestamp: 10 });
    wall += 20;
    sensors.Accelerometer.emit({ x: 0, y: 0, z: 1, timestamp: 10.02 });

    expect(accel[1]!.t - accel[0]!.t).toBe(20);
    expect(accel[2]!.t - accel[1]!.t).toBe(20);
    feed.stop();
  });
});

describe('live engine pushes', () => {
  test('four direct accel steps: 0 → 4 steps and a 3 m path due north', () => {
    const engine = createLiveEngine();
    const before = engine.getSnapshot();
    const samples = engineVerticalWalk(PLANTED, 3, 160);

    expect(before.stepCount).toBe(0);
    expect(before.heading).toBe(0);
    expect(before.rawPath).toEqual([{ x: 0, y: 0, t: 0 }]);
    expect(before.correctedPath).toEqual([{ x: 0, y: 0, t: 0 }]);
    expect(before.correctedPath).not.toBe(before.rawPath);
    expect(before.pins).toEqual([]);
    expect(samples).toHaveLength(119);

    for (const sample of samples) engine.pushAccel(sample);

    const after = engine.getSnapshot();
    expect(after.stepCount).toBe(4);
    expect(after.heading).toBe(0);
    expect(after.rawPath).toHaveLength(5);
    expect(after.rawPath[0]).toEqual({ x: 0, y: 0, t: 0 });
    expect(after.rawPath[1]).toEqual({ x: 0, y: 0.75, t: 500 });
    expect(after.rawPath[2]).toEqual({ x: 0, y: 1.5, t: 1000 });
    expect(after.rawPath[3]).toEqual({ x: 0, y: 2.25, t: 1500 });
    expect(after.rawPath[4]).toEqual({ x: 0, y: 3, t: 2000 });
    expect(after.correctedPath).toEqual(after.rawPath);
    expect(after.correctedPath).not.toBe(after.rawPath);
  });

  test('a clockwise gyro sample held across 1 s stays at 0°', () => {
    const engine = createLiveEngine();
    expect(engine.getSnapshot().heading).toBe(0);
    expect(engine.getSnapshot().stepCount).toBe(0);

    engine.pushGyro({ t: 0, yawRate: Math.PI / 2 });
    engine.pushGyro({ t: 1000, yawRate: Math.PI / 2 });

    expect(engine.getSnapshot().heading).toBe(0);
    expect(engine.getSnapshot().stepCount).toBe(0);
    expect(engine.getSnapshot().rawPath).toHaveLength(1);
  });

  test('one east magnetometer sample snaps heading to 90°', () => {
    const engine = createLiveEngine();
    engine.pushMag({ t: 0, x: 0, y: -30, z: 40 });
    expect(engine.getSnapshot().heading).toBeCloseTo(90, 6);
    expect(engine.getSnapshot().stepCount).toBe(0);
  });

  test('non-finite pushes are ignored and a returned snapshot is a copy', () => {
    const engine = createLiveEngine();
    engine.pushAccel({ t: Number.NaN, x: 0, y: 0, z: G });
    engine.pushGyro({ t: 0, yawRate: Number.POSITIVE_INFINITY });
    engine.pushMag({ t: 0, x: 0, y: 0, z: Number.NaN });
    expect(engine.getSnapshot().stepCount).toBe(0);
    expect(engine.getSnapshot().heading).toBe(0);

    engine.pushAccel({ t: 0, x: 0, y: 0, z: G });
    const snapshot = engine.getSnapshot();
    snapshot.rawPath.push({ x: 9, y: 9, t: 9 });
    snapshot.pins.push({ id: 'x', x: 1, y: 1, label: 'x' });
    expect(engine.getSnapshot().rawPath).toHaveLength(1);
    expect(engine.getSnapshot().pins).toEqual([]);
  });

  test('an emptySnapshot stands in until the first accepted sample', () => {
    const demo = mockEngine.getSnapshot();
    const engine = createLiveEngine({ emptySnapshot: demo });
    expect(engine.getSnapshot()).toEqual(demo);
    expect(engine.getSnapshot()).not.toBe(demo);
    expect(engine.getSnapshot().stepCount).toBe(12);

    engine.pushAccel({ t: Number.NaN, x: 0, y: 0, z: 1 });
    expect(engine.getSnapshot()).toEqual(demo);

    engine.pushAccel({ t: 0, x: 0, y: 0, z: G });
    const live = engine.getSnapshot();
    expect(live).not.toEqual(demo);
    expect(live.stepCount).toBe(0);
    expect(live.rawPath).toEqual([{ x: 0, y: 0, t: 0 }]);
    expect(live.pins).toEqual([]);

    engine.reset();
    expect(engine.getSnapshot()).toEqual(demo);
  });
});

describe('sensor feed into the live engine', () => {
  test('119 mocked accelerometer callbacks and one magnetometer sample: 0 → 4 steps, 3 m east', async () => {
    const sensors = motionSensors();
    const engine = createLiveEngine();
    const before = engine.getSnapshot();
    const samples = deviceVerticalWalk(PLANTED, 3, 160);

    expect(before.stepCount).toBe(0);
    expect(before.heading).toBe(0);
    expect(before.rawPath).toEqual([{ x: 0, y: 0, t: 0 }]);
    expect(samples).toHaveLength(119);

    await expect(engine.startSensors({ sensors })).resolves.toEqual({ ok: true });
    expect(engine.getSnapshot().sensorStartFailed).toBeUndefined();
    expect(sensors.Accelerometer.setUpdateInterval).toHaveBeenCalledWith(
      DEFAULT_SENSOR_UPDATE_INTERVAL_MS,
    );
    expect(sensors.Gyroscope.setUpdateInterval).toHaveBeenCalledWith(20);
    expect(sensors.Magnetometer.setUpdateInterval).toHaveBeenCalledWith(20);
    expect(sensors.Accelerometer.setUpdateInterval.mock.invocationCallOrder[0]).toBeLessThan(
      sensors.Accelerometer.addListener.mock.invocationCallOrder[0]!,
    );

    for (const sample of samples) sensors.Accelerometer.emit(sample);
    sensors.Magnetometer.emit({ x: -30, y: 0, z: -40, timestamp: 0 });
    sensors.Gyroscope.emit({ x: 0, y: 0, z: 0, timestamp: 0 });

    const after = engine.getSnapshot();
    expect(after.stepCount).toBe(4);
    expect(after.heading).toBeCloseTo(90, 6);
    expect(after.rawPath).toHaveLength(5);
    expect(after.rawPath[0]).toEqual({ x: 0, y: 0, t: 0 });
    expect(after.rawPath[1]!.x).toBeCloseTo(0.75, 6);
    expect(after.rawPath[1]!.y).toBeCloseTo(0, 6);
    expect(after.rawPath[1]!.t).toBe(500);
    expect(after.rawPath[2]!.x).toBeCloseTo(1.5, 6);
    expect(after.rawPath[2]!.y).toBeCloseTo(0, 6);
    expect(after.rawPath[3]!.x).toBeCloseTo(2.25, 6);
    expect(after.rawPath[4]!.x).toBeCloseTo(3, 6);
    expect(after.rawPath[4]!.y).toBeCloseTo(0, 6);
    expect(after.rawPath[4]!.t).toBe(2000);
    expect(after.correctedPath).toHaveLength(5);
    expect(after.pins).toEqual([]);

    const accelRemove = sensors.Accelerometer.addListener.mock.results[0]!.value
      .remove as jest.Mock;
    engine.stopSensors();
    expect(accelRemove).toHaveBeenCalledTimes(1);

    for (const sample of samples) {
      sensors.Accelerometer.emit({ ...sample, timestamp: sample.timestamp! + 20 });
    }
    expect(engine.getSnapshot().stepCount).toBe(4);
    expect(engine.getSnapshot().rawPath).toHaveLength(5);
  });

  test('stop brakes yaw at the last sample time and a second stop does not repeat it', async () => {
    const sensors = motionSensors();
    const gyro: GyroSample[] = [];
    const feed = await startSensorFeed(
      {
        pushAccel: () => undefined,
        pushGyro: (sample) => gyro.push(sample),
        pushMag: () => undefined,
      },
      { sensors },
    );

    sensors.Gyroscope.emit({ x: 0, y: 0, z: -1, timestamp: 1 });
    sensors.Gyroscope.emit({ x: 0, y: 0, z: -1, timestamp: 1.02 });
    feed.stop();
    feed.stop();

    expect(gyro).toEqual([
      { t: 1000, yawRate: 1 },
      { t: 1020, yawRate: 1 },
      { t: 1020, brake: true },
    ]);
  });

  test('stopSensors holds 90° across a 1.5 s pause instead of adding 135°', async () => {
    const first = motionSensors();
    const engine = createLiveEngine();
    await engine.startSensors({ sensors: first });

    for (let step = 0; step <= 50; step += 1) {
      first.Gyroscope.emit({ x: 0, y: 0, z: -Math.PI / 2, timestamp: step * 0.02 });
    }
    expect(engine.getSnapshot().heading).toBeCloseTo(90, 6);

    engine.stopSensors();

    const resumed = motionSensors();
    await engine.startSensors({ sensors: resumed });
    resumed.Gyroscope.emit({ x: 0, y: 0, z: 0, timestamp: 2.5 });

    expect(engine.getSnapshot().heading).toBeCloseTo(90, 6);
    engine.stopSensors();
  });

  test('a device gyro of −π/2 rad/s for 1 s reaches the engine as heading 90°', async () => {
    const sensors = motionSensors();
    const engine = createLiveEngine();
    await engine.startSensors({ sensors });
    expect(engine.getSnapshot().heading).toBe(0);

    for (let step = 0; step <= 50; step += 1) {
      sensors.Gyroscope.emit({ x: 0, y: 0, z: -Math.PI / 2, timestamp: step * 0.02 });
    }

    expect(engine.getSnapshot().heading).toBeCloseTo(90, 6);
    expect(engine.getSnapshot().stepCount).toBe(0);
    engine.stopSensors();
  });

  test('a start with no subscribed sensor reports permission and stays idle', async () => {
    const sensors = motionSensors({
      Accelerometer: fakeSensor({ granted: false }),
      Gyroscope: fakeSensor({ available: false }),
      Magnetometer: fakeSensor({ failAvailable: true }),
    });
    const engine = createLiveEngine();
    await expect(engine.startSensors({ sensors })).resolves.toEqual({
      ok: false,
      reason: 'permission',
    });
    expect(engine.sensorsActive()).toBe(false);
    expect(engine.getSnapshot().sensorStartFailed).toBe('permission');

    expect(sensors.Accelerometer.addListener).not.toHaveBeenCalled();
    expect(sensors.Gyroscope.addListener).not.toHaveBeenCalled();
    expect(sensors.Magnetometer.addListener).not.toHaveBeenCalled();
    expect(sensors.Accelerometer.setUpdateInterval).not.toHaveBeenCalled();

    for (const sample of deviceVerticalWalk(PLANTED, 3, 160)) sensors.Accelerometer.emit(sample);
    expect(engine.getSnapshot().stepCount).toBe(0);
    expect(engine.getSnapshot().sensorStartFailed).toBe('permission');
    engine.stopSensors();
    expect(engine.getSnapshot().sensorStartFailed).toBeUndefined();
  });

  test('a failed start is not a live walk while a recalled snapshot is showing', async () => {
    const saved: EngineSnapshot = {
      rawPath: [
        { x: 0, y: 0, t: 0 },
        { x: 3, y: 0, t: 800 },
      ],
      correctedPath: [
        { x: 0, y: 0, t: 0 },
        { x: 3, y: 0, t: 800 },
      ],
      stepCount: 4,
      heading: 12,
      pins: [],
    };
    const sensors = motionSensors({
      Accelerometer: fakeSensor({ granted: false }),
      Gyroscope: fakeSensor({ granted: false }),
      Magnetometer: fakeSensor({ granted: false }),
    });
    const engine = createLiveEngine();
    engine.recallSnapshot(saved);

    const started = await engine.startSensors({ sensors });
    engine.pushStep({ t: 500, heading: 90 });
    const during = engine.getSnapshot();
    const duringActive = engine.sensorsActive();
    engine.clearRecall();
    const after = engine.getSnapshot();

    expect({
      started,
      duringActive,
      duringStepCount: during.stepCount,
      duringHeading: during.heading,
      duringFault: during.sensorStartFailed ?? null,
      afterStepCount: after.stepCount,
      afterHeading: after.heading,
      afterFault: after.sensorStartFailed ?? null,
      afterActive: engine.sensorsActive(),
    }).toEqual({
      started: { ok: false, reason: 'permission' },
      duringActive: false,
      duringStepCount: 4,
      duringHeading: 12,
      duringFault: 'permission',
      afterStepCount: 1,
      afterHeading: 90,
      afterFault: 'permission',
      afterActive: false,
    });
    expect(engine.snapshotForSave().sensorStartFailed).toBeUndefined();
    expect(engine.snapshotForSave().stepCount).toBe(1);
    engine.reset();
    expect(engine.getSnapshot().sensorStartFailed).toBeUndefined();
    expect(engine.isRecalled()).toBe(false);
    engine.recallSnapshot({ ...saved, sensorStartFailed: 'error' });
    expect(engine.getSnapshot().sensorStartFailed).toBeUndefined();
    expect(engine.getSnapshot().stepCount).toBe(4);
  });

  test('an Expo listen failure resolves as an error instead of a live session', async () => {
    const sensors = motionSensors({
      Accelerometer: fakeSensor({ failListen: true }),
      Gyroscope: fakeSensor({ failListen: true }),
      Magnetometer: fakeSensor({ failListen: true }),
    });
    const engine = createLiveEngine();
    const started = await engine.startSensors({ sensors }).then(
      (value) => value,
      (error: unknown) => error,
    );
    expect({
      rejected: started instanceof Error,
      started: started instanceof Error ? started.message : started,
      fault: engine.getSnapshot().sensorStartFailed ?? null,
      active: engine.sensorsActive(),
    }).toEqual({
      rejected: false,
      started: { ok: false, reason: 'error' },
      fault: 'error',
      active: false,
    });
  });

  test('a throw while reading a sensor resolves as an error', async () => {
    const sensors: MotionSensors = {
      get Accelerometer(): MotionSensor {
        throw new Error('expo module failed');
      },
      Gyroscope: fakeSensor(),
      Magnetometer: fakeSensor(),
    };
    const engine = createLiveEngine();
    await expect(engine.startSensors({ sensors })).resolves.toEqual({
      ok: false,
      reason: 'error',
    });
    expect(engine.sensorsActive()).toBe(false);
    expect(engine.getSnapshot().sensorStartFailed).toBe('error');
    engine.pushStep({ t: 500, heading: 0 });
    expect(engine.getSnapshot().stepCount).toBe(1);
    expect(engine.getSnapshot().sensorStartFailed).toBe('error');
  });

  test('a start where every sensor is unavailable reports unavailable', async () => {
    const sensors = motionSensors({
      Accelerometer: fakeSensor({ available: false }),
      Gyroscope: fakeSensor({ available: false }),
      Magnetometer: fakeSensor({ available: false }),
    });
    const engine = createLiveEngine();
    await expect(engine.startSensors({ sensors })).resolves.toEqual({
      ok: false,
      reason: 'unavailable',
    });
    expect(engine.sensorsActive()).toBe(false);
    expect(engine.getSnapshot().sensorStartFailed).toBe('unavailable');
  });

  test('an accelerometer-only or gyroscope-only start stays idle', async () => {
    const accelOnly = motionSensors({
      Accelerometer: fakeSensor(),
      Gyroscope: fakeSensor({ granted: false }),
      Magnetometer: fakeSensor({ available: false }),
    });
    const engine = createLiveEngine();
    await expect(engine.startSensors({ sensors: accelOnly })).resolves.toEqual({
      ok: false,
      reason: 'permission',
    });
    expect(engine.sensorsActive()).toBe(false);
    expect(engine.getSnapshot()).toMatchObject({
      sensorStartFailed: 'permission',
      heading: 0,
      stepCount: 0,
      rawPath: [{ x: 0, y: 0, t: 0 }],
    });
    expect(engine.getSnapshot().gyroOnly).toBeUndefined();

    for (const sample of deviceVerticalWalk(PLANTED, 3, 160)) accelOnly.Accelerometer.emit(sample);
    expect(engine.getSnapshot().stepCount).toBe(0);
    expect(engine.getSnapshot().heading).toBe(0);
    expect(engine.getSnapshot().rawPath).toEqual([{ x: 0, y: 0, t: 0 }]);
    expect(engine.getSnapshot().gyroOnly).toBeUndefined();

    const gyroOnly = motionSensors({
      Accelerometer: fakeSensor({ available: false }),
      Gyroscope: fakeSensor(),
      Magnetometer: fakeSensor(),
    });
    await expect(engine.startSensors({ sensors: gyroOnly })).resolves.toEqual({
      ok: false,
      reason: 'unavailable',
    });
    expect(engine.sensorsActive()).toBe(false);
    expect(engine.getSnapshot().sensorStartFailed).toBe('unavailable');
    for (let step = 0; step <= 50; step += 1) {
      gyroOnly.Gyroscope.emit({ x: 0, y: 0, z: -Math.PI / 2, timestamp: step * 0.02 });
    }
    expect(engine.getSnapshot().heading).toBe(0);
    expect(engine.getSnapshot().gyroOnly).toBeUndefined();
    expect(engine.getSnapshot().stepCount).toBe(0);
  });

  test('a missing magnetometer still starts, and a 1 s gyro turn walks east', async () => {
    const denied = motionSensors({
      Accelerometer: fakeSensor({ granted: false }),
      Gyroscope: fakeSensor({ granted: false }),
      Magnetometer: fakeSensor({ granted: false }),
    });
    const granted = motionSensors({
      Accelerometer: fakeSensor(),
      Gyroscope: fakeSensor(),
      Magnetometer: fakeSensor({ available: false }),
    });
    const engine = createLiveEngine();
    await engine.startSensors({ sensors: denied });
    expect(engine.getSnapshot().sensorStartFailed).toBe('permission');

    await expect(engine.startSensors({ sensors: granted })).resolves.toEqual({ ok: true });
    expect(engine.sensorsActive()).toBe(true);
    expect(engine.getSnapshot().sensorStartFailed).toBeUndefined();
    expect(granted.Accelerometer.addListener).toHaveBeenCalledTimes(1);
    expect(granted.Gyroscope.addListener).toHaveBeenCalledTimes(1);
    expect(granted.Magnetometer.addListener).not.toHaveBeenCalled();

    for (let step = 0; step <= 50; step += 1) {
      granted.Gyroscope.emit({ x: 0, y: 0, z: -Math.PI / 2, timestamp: step * 0.02 });
    }
    expect(engine.getSnapshot().heading).toBeCloseTo(90, 6);
    expect(engine.getSnapshot().gyroOnly).toBe(true);
    expect(engine.getSnapshot().stepCount).toBe(0);

    for (const sample of deviceVerticalWalk([1500, 2000, 2500, 3000], 3, 160)) {
      granted.Accelerometer.emit(sample);
    }
    const walked = engine.getSnapshot();
    expect(walked.stepCount).toBe(4);
    expect(walked.heading).toBeCloseTo(90, 6);
    expect(walked.gyroOnly).toBe(true);
    expect(walked.rawPath[0]).toEqual({ x: 0, y: 0, t: 0 });
    expect(walked.rawPath[4]!.x).toBeCloseTo(3, 6);
    expect(walked.rawPath[4]!.y).toBeCloseTo(0, 6);
    expect(walked.rawPath[4]!.t).toBe(3000);
    expect(walked.sensorStartFailed).toBeUndefined();
    engine.stopSensors();
  });

  test('permission is checked before availability, then the interval, then the listener', async () => {
    const sensors = motionSensors();
    const engine = createLiveEngine();
    await engine.startSensors({ sensors, updateIntervalMs: 40 });

    const permission = sensors.Accelerometer.requestPermissionsAsync.mock.invocationCallOrder[0]!;
    const available = sensors.Accelerometer.isAvailableAsync.mock.invocationCallOrder[0]!;
    const interval = sensors.Accelerometer.setUpdateInterval.mock.invocationCallOrder[0]!;
    const listen = sensors.Accelerometer.addListener.mock.invocationCallOrder[0]!;
    expect(permission).toBeLessThan(available);
    expect(available).toBeLessThan(interval);
    expect(interval).toBeLessThan(listen);
    expect(sensors.Accelerometer.setUpdateInterval).toHaveBeenCalledWith(40);
    engine.stopSensors();
  });

  test('a non-positive interval falls back to 20 ms, and a bare sensor still subscribes', async () => {
    const captured: { listener: ((measurement: SensorMeasurement) => void) | null } = {
      listener: null,
    };
    const accelerometer: MotionSensor = {
      addListener: jest.fn((fn: (measurement: SensorMeasurement) => void) => {
        captured.listener = fn;
        return { remove: jest.fn() };
      }),
      setUpdateInterval: jest.fn(),
    };
    const other: MotionSensor = {
      addListener: jest.fn(() => ({ remove: jest.fn() })),
      setUpdateInterval: jest.fn(),
    };
    const accel: { t: number; x: number; y: number; z: number }[] = [];
    const feed = await startSensorFeed(
      {
        pushAccel: (sample) => accel.push(sample),
        pushGyro: () => undefined,
        pushMag: () => undefined,
      },
      {
        sensors: { Accelerometer: accelerometer, Gyroscope: other, Magnetometer: other },
        updateIntervalMs: -5,
        nowMs: () => 10,
      },
    );

    expect(accelerometer.setUpdateInterval).toHaveBeenCalledWith(20);
    expect(accelerometer.addListener).toHaveBeenCalledTimes(1);
    captured.listener?.({ x: 0, y: 0, z: 1 });
    expect(accel).toEqual([{ t: 10, x: 0, y: 0, z: -G }]);
    feed.stop();
    captured.listener?.({ x: 0, y: 0, z: 1 });
    expect(accel).toHaveLength(1);
  });

  test('a second startSensors does not add another listener', async () => {
    const sensors = motionSensors();
    const engine = createLiveEngine();
    await engine.startSensors({ sensors });
    await engine.startSensors({ sensors });
    expect(sensors.Accelerometer.addListener).toHaveBeenCalledTimes(1);
    expect(sensors.Gyroscope.addListener).toHaveBeenCalledTimes(1);
    expect(sensors.Magnetometer.addListener).toHaveBeenCalledTimes(1);
    engine.stopSensors();
    engine.stopSensors();
  });

  test('stop during start removes the listener and drops a synchronous sample', async () => {
    let release: (available: boolean) => void = () => undefined;
    const gate = new Promise<boolean>((resolve) => {
      release = resolve;
    });
    const remove = jest.fn();
    const accel: FakeSensor = {
      addListener: jest.fn((fn: (measurement: SensorMeasurement) => void) => {
        fn({ x: 0, y: 0, z: 1, timestamp: 1 });
        return { remove };
      }),
      setUpdateInterval: jest.fn(),
      isAvailableAsync: jest.fn(() => gate),
      requestPermissionsAsync: jest.fn(async () => ({ granted: true })),
      emit: () => undefined,
    };
    const engine = createLiveEngine();
    const pending = engine.startSensors({
      sensors: motionSensors({ Accelerometer: accel }),
    });
    await Promise.resolve();
    engine.stopSensors();
    release(true);
    await expect(pending).resolves.toEqual({ ok: false, reason: 'cancelled' });

    expect(remove).toHaveBeenCalledTimes(1);
    expect(engine.sensorsActive()).toBe(false);
    expect(engine.getSnapshot().sensorStartFailed).toBeUndefined();
    expect(engine.getSnapshot().stepCount).toBe(0);
    expect(engine.getSnapshot().rawPath).toEqual([{ x: 0, y: 0, t: 0 }]);
  });

  test('the default feed subscribes to expo-sensors and never calls Pedometer', async () => {
    const engine = createLiveEngine();
    await engine.startSensors();

    const { Accelerometer, Gyroscope, Magnetometer } = jest.requireMock('expo-sensors') as {
      Accelerometer: { addListener: jest.Mock; setUpdateInterval: jest.Mock };
      Gyroscope: { addListener: jest.Mock };
      Magnetometer: { addListener: jest.Mock };
    };
    expect(Accelerometer.setUpdateInterval).toHaveBeenCalledWith(20);
    expect(Accelerometer.addListener).toHaveBeenCalledTimes(1);
    expect(Gyroscope.addListener).toHaveBeenCalledTimes(1);
    expect(Magnetometer.addListener).toHaveBeenCalledTimes(1);
    expect(Pedometer.watchStepCount).not.toHaveBeenCalled();
    expect(Pedometer.getStepCountAsync).not.toHaveBeenCalled();
    engine.stopSensors();
  });
});

describe('getEngine', () => {
  test('returns the live engine and still exports the static mock', () => {
    const engine = getEngine();
    expect(engine).toBe(getLiveEngine());
    expect(engine).not.toBe(mockEngine);
    expect(typeof engine.startSensors).toBe('function');
    expect(typeof engine.stopSensors).toBe('function');
    expect(engine.sensorsActive()).toBe(false);
    expect(engine.getSnapshot()).toEqual(mockEngine.getSnapshot());
    expect(engine.getSnapshot()).not.toBe(mockEngine.getSnapshot());
    expect(mockEngine.getSnapshot().stepCount).toBe(12);
    expect(mockEngine.getSnapshot().heading).toBe(90);
    expect(mockEngine.getSnapshot().rawPath).toHaveLength(7);
    expect(mockEngine.getSnapshot().correctedPath).toHaveLength(7);
    expect(mockEngine.getSnapshot().pins.map((pin) => pin.id)).toEqual(['door', 'desk']);
  });

  test('startSensors and stopSensors follow getEngine and leave the demo untouched', async () => {
    const sensors = motionSensors();
    expect(getEngine().sensorsActive()).toBe(false);
    await startSensors({ sensors });
    expect(getEngine().sensorsActive()).toBe(true);
    expect(sensors.Accelerometer.addListener).toHaveBeenCalledTimes(1);
    expect(getEngine().getSnapshot()).toEqual(mockEngine.getSnapshot());
    expect(getEngine().snapshotForSave()).toEqual({
      rawPath: [{ x: 0, y: 0, t: 0 }],
      correctedPath: [{ x: 0, y: 0, t: 0 }],
      stepCount: 0,
      heading: 0,
      pins: [],
    });
    expect(getEngine().getSnapshot().stepCount).toBe(12);

    stopSensors();
    expect(getEngine().sensorsActive()).toBe(false);
    const remove = sensors.Accelerometer.addListener.mock.results[0]!.value.remove as jest.Mock;
    expect(remove).toHaveBeenCalledTimes(1);
    sensors.Accelerometer.emit({ x: 0, y: 0, z: 2, timestamp: 1 });
    expect(getEngine().getSnapshot().stepCount).toBe(12);
  });
});
