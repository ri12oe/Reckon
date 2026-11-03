import { createLiveEngine, type EngineSnapshot, type SensorStartResult } from '@/engine';

import { startWalkSensors } from '@/walk/sensors';

const floor = { id: 'north-1', buildingName: 'North Hall', name: 'Level 1' };

const savedFloor: EngineSnapshot = {
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
};

function settled(result: SensorStartResult) {
  const engine = createLiveEngine();
  const startSensors = jest.spyOn(engine, 'startSensors').mockResolvedValue(result);
  return { engine, startSensors };
}

describe('walk sensor start while the screen is focused', () => {
  test('a recalled floor does not start sensors', async () => {
    const { engine, startSensors } = settled({ ok: true });
    engine.recallSnapshot(savedFloor);
    const refresh = jest.fn();

    await startWalkSensors(engine, floor, () => true, refresh);
    await startWalkSensors(engine, null, () => true, refresh);

    expect(startSensors).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
    expect(engine.sensorsActive()).toBe(false);
    expect(engine.getSnapshot().sensorStartFailed).toBeUndefined();
  });

  test('a saved floor on screen does not start sensors when the engine is already live', async () => {
    const { engine, startSensors } = settled({ ok: true });
    const refresh = jest.fn();

    await startWalkSensors(engine, floor, () => true, refresh);

    expect(engine.isRecalled()).toBe(false);
    expect(startSensors).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  test('resume live walk starts sensors after the saved floor is cleared', async () => {
    const { engine, startSensors } = settled({ ok: true });
    engine.recallSnapshot(savedFloor);
    const refresh = jest.fn();

    await startWalkSensors(engine, floor, () => true, refresh);
    engine.clearRecall();
    await startWalkSensors(engine, null, () => true, refresh);

    expect(startSensors).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(engine.isRecalled()).toBe(false);
  });

  test('a live focus starts sensors and refreshes when the start settles', async () => {
    const { engine, startSensors } = settled({ ok: true });
    const refresh = jest.fn();

    await startWalkSensors(engine, null, () => true, refresh);

    expect(startSensors).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(engine.isRecalled()).toBe(false);
  });

  test('a later live focus starts sensors again', async () => {
    const { engine, startSensors } = settled({ ok: true });
    const refresh = jest.fn();

    await startWalkSensors(engine, null, () => true, refresh);
    await startWalkSensors(engine, null, () => true, refresh);

    expect(startSensors).toHaveBeenCalledTimes(2);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  test('a cancelled start does not refresh the walk', async () => {
    const { engine, startSensors } = settled({ ok: false, reason: 'cancelled' });
    const refresh = jest.fn();

    await startWalkSensors(engine, null, () => true, refresh);

    expect(startSensors).toHaveBeenCalledTimes(1);
    expect(refresh).not.toHaveBeenCalled();
  });

  test('a permission fault still refreshes so the pill can show it', async () => {
    const { engine, startSensors } = settled({ ok: false, reason: 'permission' });
    const refresh = jest.fn();

    await startWalkSensors(engine, null, () => true, refresh);

    expect(startSensors).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  test('a start that settles after the screen blurs does not refresh', async () => {
    let release: (result: SensorStartResult) => void = () => undefined;
    const engine = createLiveEngine();
    const startSensors = jest.spyOn(engine, 'startSensors').mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    let focused = true;
    const refresh = jest.fn();
    const pending = startWalkSensors(engine, null, () => focused, refresh);

    focused = false;
    release({ ok: false, reason: 'permission' });
    await pending;

    expect(startSensors).toHaveBeenCalledTimes(1);
    expect(refresh).not.toHaveBeenCalled();
  });
});
