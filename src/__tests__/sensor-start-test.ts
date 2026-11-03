import {
  createLiveEngine,
  mockEngine,
  type MotionSensor,
  type MotionSensors,
  type SensorStartFault,
} from '@/engine';

import { sensorStartFaultMessage, walkPill } from '@/sensor-start';

const FAULTS: SensorStartFault[] = ['permission', 'unavailable', 'error'];

describe('sensorStartFaultMessage', () => {
  test('a denied, missing, or thrown start is a fault message', () => {
    expect(sensorStartFaultMessage({ ok: false, reason: 'permission' })).toBe(
      'motion permission needed',
    );
    expect(sensorStartFaultMessage({ ok: false, reason: 'unavailable' })).toBe(
      'motion sensors unavailable',
    );
    expect(sensorStartFaultMessage({ ok: false, reason: 'error' })).toBe('could not start sensors');
  });

  test('a subscribed start and a cancelled start are not faults', () => {
    expect(sensorStartFaultMessage({ ok: true })).toBeNull();
    expect(sensorStartFaultMessage({ ok: false, reason: 'cancelled' })).toBeNull();
  });
});

describe('walkPill', () => {
  test('a saved floor stays Saved floor when a start fault is also set', () => {
    expect(walkPill(true, 'permission', false)).toEqual({ label: 'Saved floor', live: false });
    expect(walkPill(true, undefined, false)).toEqual({ label: 'Saved floor', live: false });
  });

  test('a saved floor stays Saved floor while the phone is tilted', () => {
    expect(walkPill(true, undefined, true)).toEqual({ label: 'Saved floor', live: false });
    expect(walkPill(true, 'permission', true)).toEqual({ label: 'Saved floor', live: false });
  });

  test('a fault with no saved floor is not a healthy Live session', () => {
    for (const fault of FAULTS) {
      const pill = walkPill(false, fault, false);
      expect(pill.live).toBe(false);
      expect(pill.label).toBe(sensorStartFaultMessage({ ok: false, reason: fault }));
      expect(pill.label).not.toBe('Live');
      expect(walkPill(false, fault, true).label).toBe(pill.label);
    }
  });

  test('a live walk reads Live when the phone is level and the tilt pause when it is not', () => {
    expect(walkPill(false, undefined, false)).toEqual({ label: 'Live', live: true });
    expect(walkPill(false, undefined, true)).toEqual({
      label: 'Paused, hold it level',
      live: false,
    });
    expect(walkPill(false, undefined, false)).toEqual({ label: 'Live', live: true });
  });

  test('the canned demo stays Live', () => {
    const demo = mockEngine.getSnapshot();
    expect(demo.isCannedDemo).toBe(true);
    expect(demo.pitchPaused).toBe(false);
    expect(walkPill(false, demo.sensorStartFailed, demo.pitchPaused)).toEqual({
      label: 'Live',
      live: true,
    });
  });
});

function motionSensor(granted: boolean): MotionSensor {
  return {
    addListener: () => ({ remove: () => undefined }),
    setUpdateInterval: () => undefined,
    isAvailableAsync: async () => true,
    requestPermissionsAsync: async () => ({ granted }),
  };
}

function motionSensors(granted: boolean): MotionSensors {
  return {
    Accelerometer: motionSensor(granted),
    Gyroscope: motionSensor(granted),
    Magnetometer: motionSensor(granted),
  };
}

describe('walk pill and a real start', () => {
  test('a denial stays on the snapshot after clearRecall and the pill is not Live', async () => {
    const engine = createLiveEngine();
    const started = await engine.startSensors({ sensors: motionSensors(false) });
    expect(started).toEqual({ ok: false, reason: 'permission' });
    const denied = engine.getSnapshot();
    expect(walkPill(false, denied.sensorStartFailed, denied.pitchPaused)).toEqual({
      label: 'motion permission needed',
      live: false,
    });

    engine.recallSnapshot({
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
      pitchPaused: false,
    });
    const recalled = engine.getSnapshot();
    expect(walkPill(true, recalled.sensorStartFailed, recalled.pitchPaused)).toEqual({
      label: 'Saved floor',
      live: false,
    });

    engine.pushStep({ t: 500, heading: 90 });
    engine.clearRecall();
    const after = engine.getSnapshot();
    expect(after.stepCount).toBe(0);
    expect(after.sensorStartFailed).toBe('permission');
    expect(engine.sensorsActive()).toBe(false);
    expect(walkPill(false, after.sensorStartFailed, after.pitchPaused)).toEqual({
      label: 'motion permission needed',
      live: false,
    });
    engine.stopSensors();
    const cleared = engine.getSnapshot();
    expect(walkPill(false, cleared.sensorStartFailed, cleared.pitchPaused)).toEqual({
      label: 'Live',
      live: true,
    });
  });

  test('a start cancelled by stopSensors does not mark the pill failed', async () => {
    let release: (available: boolean) => void = () => undefined;
    const gate = new Promise<boolean>((resolve) => {
      release = resolve;
    });
    const accelerometer: MotionSensor = {
      addListener: () => ({ remove: () => undefined }),
      setUpdateInterval: () => undefined,
      isAvailableAsync: () => gate,
      requestPermissionsAsync: async () => ({ granted: true }),
    };
    const engine = createLiveEngine();
    const pending = engine.startSensors({
      sensors: {
        Accelerometer: accelerometer,
        Gyroscope: motionSensor(true),
        Magnetometer: motionSensor(true),
      },
    });
    await Promise.resolve();
    engine.stopSensors();
    release(true);
    const started = await pending;
    expect(sensorStartFaultMessage(started)).toBeNull();
    const shown = engine.getSnapshot();
    expect(shown.sensorStartFailed).toBeUndefined();
    expect(walkPill(false, shown.sensorStartFailed, shown.pitchPaused)).toEqual({
      label: 'Live',
      live: true,
    });
  });
});
