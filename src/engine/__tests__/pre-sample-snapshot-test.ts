import { Platform } from 'react-native';

import { createLiveEngine, getEngine, mockEngine, type EngineSnapshot } from '@/engine';
import { STANDARD_GRAVITY_MPS2 } from '@/engine/step-detector';

const LIVE_BEFORE: EngineSnapshot = {
  rawPath: [],
  correctedPath: [],
  stepCount: 0,
  heading: Number.NaN,
  pins: [],
  pitchPaused: false,
};

const AFTER_ONE_ACCEL = {
  rawPath: [{ x: 0, y: 0, t: 0 }],
  correctedPath: [{ x: 0, y: 0, t: 0 }],
  stepCount: 0,
  heading: 0,
};

function finiteAccel() {
  return { t: 0, x: 0, y: 0, z: STANDARD_GRAVITY_MPS2 };
}

describe('snapshot before the first finite sample', () => {
  test('live sensors report an empty path and no heading, then the real sample', () => {
    expect(Platform.OS).not.toBe('web');
    const engine = getEngine();
    const before = engine.getSnapshot();
    const mock = mockEngine.getSnapshot();

    expect({
      rawPoints: before.rawPath.length,
      correctedPoints: before.correctedPath.length,
      stepCount: before.stepCount,
      headingFinite: Number.isFinite(before.heading),
      heading: before.heading,
      pins: before.pins.length,
      isCannedDemo: before.isCannedDemo === true,
    }).toEqual({
      rawPoints: 0,
      correctedPoints: 0,
      stepCount: 0,
      headingFinite: false,
      heading: Number.NaN,
      pins: 0,
      isCannedDemo: false,
    });
    expect(before).toEqual(LIVE_BEFORE);
    expect(before.stepCount).not.toBe(mock.stepCount);
    expect(before.heading).not.toBe(mock.heading);
    expect(before.rawPath).not.toEqual(mock.rawPath);

    engine.pushAccel({ t: Number.NaN, x: 0, y: 0, z: STANDARD_GRAVITY_MPS2 });
    expect(engine.getSnapshot()).toEqual(LIVE_BEFORE);

    engine.pushAccel(finiteAccel());
    const after = engine.getSnapshot();
    expect({
      rawPoints: after.rawPath.length,
      correctedPoints: after.correctedPath.length,
      stepCount: after.stepCount,
      heading: after.heading,
      isCannedDemo: after.isCannedDemo === true,
      origin: after.rawPath[0],
    }).toEqual({
      rawPoints: 1,
      correctedPoints: 1,
      stepCount: 0,
      heading: 0,
      isCannedDemo: false,
      origin: { x: 0, y: 0, t: 0 },
    });
    expect(after).toMatchObject(AFTER_ONE_ACCEL);
    expect(after.heading).not.toBe(mock.heading);
    expect(after.rawPath).not.toEqual(mock.rawPath);
  });

  test('a canned engine keeps 12 steps and heading 90 until the first finite sample', () => {
    const demo = mockEngine.getSnapshot();
    const engine = createLiveEngine({ emptySnapshot: demo });
    const before = engine.getSnapshot();

    expect({
      rawPoints: before.rawPath.length,
      correctedPoints: before.correctedPath.length,
      stepCount: before.stepCount,
      heading: before.heading,
      pins: before.pins.map((pin) => pin.id),
      second: before.correctedPath[1],
      isCannedDemo: before.isCannedDemo === true,
    }).toEqual({
      rawPoints: 7,
      correctedPoints: 7,
      stepCount: 12,
      heading: 90,
      pins: ['door', 'desk'],
      second: { x: 1.5, y: 0, t: 1200 },
      isCannedDemo: true,
    });
    expect(before).toEqual(demo);
    expect(before).not.toBe(demo);

    engine.pushAccel({ t: Number.NaN, x: 0, y: 0, z: 1 });
    expect(engine.getSnapshot().stepCount).toBe(12);
    expect(engine.getSnapshot().heading).toBe(90);
    expect(engine.getSnapshot().rawPath).toHaveLength(7);

    engine.pushAccel(finiteAccel());
    const after = engine.getSnapshot();
    expect({
      rawPoints: after.rawPath.length,
      correctedPoints: after.correctedPath.length,
      stepCount: after.stepCount,
      heading: after.heading,
      isCannedDemo: after.isCannedDemo === true,
      origin: after.rawPath[0],
    }).toEqual({
      rawPoints: 1,
      correctedPoints: 1,
      stepCount: 0,
      heading: 0,
      isCannedDemo: false,
      origin: { x: 0, y: 0, t: 0 },
    });
    expect(after.rawPath).not.toEqual(demo.rawPath);
    expect(after.heading).not.toBe(90);
  });

  test('web getEngine keeps the canned path and heading 90 until a real sample', () => {
    jest.isolateModules(() => {
      // isolateModules only accepts a synchronous factory.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const reactNative = require('react-native') as typeof import('react-native');
      const previous = reactNative.Platform.OS;
      reactNative.Platform.OS = 'web';
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const loaded = require('@/engine') as typeof import('@/engine');
      const engine = loaded.getEngine();
      try {
        const before = engine.getSnapshot();
        const mock = loaded.mockEngine.getSnapshot();

        expect({
          rawPoints: before.rawPath.length,
          correctedPoints: before.correctedPath.length,
          stepCount: before.stepCount,
          heading: before.heading,
          isCannedDemo: before.isCannedDemo === true,
        }).toEqual({
          rawPoints: 7,
          correctedPoints: 7,
          stepCount: 12,
          heading: 90,
          isCannedDemo: true,
        });
        expect(before).toEqual(mock);

        engine.pushAccel({ t: Number.NaN, x: 0, y: 0, z: 1 });
        expect(engine.getSnapshot().heading).toBe(90);
        expect(engine.getSnapshot().rawPath).toHaveLength(7);

        engine.pushAccel(finiteAccel());
        const after = engine.getSnapshot();
        expect({
          rawPoints: after.rawPath.length,
          stepCount: after.stepCount,
          heading: after.heading,
          isCannedDemo: after.isCannedDemo === true,
        }).toEqual({
          rawPoints: 1,
          stepCount: 0,
          heading: 0,
          isCannedDemo: false,
        });
        expect(after.rawPath).toEqual([{ x: 0, y: 0, t: 0 }]);
      } finally {
        reactNative.Platform.OS = previous;
      }
    });
  });
});
