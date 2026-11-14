import {
  closeLoop,
  createLiveEngine,
  isCannedDemo,
  loopClosureCounts,
  mockEngine,
  type EngineSnapshot,
  type LiveFloorwalkerEngine,
} from '@/engine';
import { STANDARD_GRAVITY_MPS2 } from '@/engine/step-detector';
import { assertBackAtStart, releaseBackAtStart, showBackAtStart } from '@/walk/close-loop';

const desk = { id: 'desk', x: 1.5, y: 2.5, label: 'desk' };

function east(engine: LiveFloorwalkerEngine, count: number, t0 = 0) {
  for (let index = 0; index < count; index += 1) {
    engine.pushStep({ t: t0 + (index + 1) * 500, heading: 90 });
  }
}

function gaps(snapshot: EngineSnapshot) {
  const start = snapshot.correctedPath[0];
  const end = snapshot.correctedPath.at(-1);
  const raw = snapshot.rawPath.at(-1);
  if (!start || !end || !raw) throw new Error('path is empty');
  return {
    correctedFromStart: Math.hypot(end.x - start.x, end.y - start.y),
    rawFromStart: Math.hypot(raw.x - start.x, raw.y - start.y),
    rawFromCorrected: Math.hypot(raw.x - end.x, raw.y - end.y),
  };
}

describe('back at start visibility', () => {
  test('hides on the canned demo picture', () => {
    const engine = createLiveEngine({ emptySnapshot: mockEngine.getSnapshot() });
    const shown = engine.getSnapshot();

    expect(shown.isCannedDemo).toBe(true);
    expect(shown.stepCount).toBeGreaterThan(0);
    expect(showBackAtStart(shown)).toBe(false);
  });

  test('hides a canned demo even when its corrected end is the start', () => {
    const nearStart: EngineSnapshot = {
      rawPath: [
        { x: 0, y: 0, t: 0 },
        { x: 0, y: 0, t: 500 },
      ],
      correctedPath: [
        { x: 0, y: 0, t: 0 },
        { x: 0, y: 0, t: 500 },
      ],
      stepCount: 1,
      heading: 0,
      pins: [],
      pitchPaused: false,
      isCannedDemo: true,
    };
    const engine = createLiveEngine({ emptySnapshot: nearStart });
    const shown = engine.getSnapshot();

    expect(isCannedDemo(shown)).toBe(true);
    expect(shown.stepCount).toBeGreaterThan(0);
    expect(gaps(shown).correctedFromStart).toBe(0);
    expect(showBackAtStart(shown)).toBe(false);
  });

  test('hides after the first live sample and before a step', () => {
    const engine = createLiveEngine({ emptySnapshot: mockEngine.getSnapshot() });
    engine.pushAccel({ t: 0, x: 0, y: 0, z: STANDARD_GRAVITY_MPS2 });
    const shown = engine.getSnapshot();

    expect(isCannedDemo(shown)).toBe(false);
    expect(shown.stepCount).toBe(0);
    expect(gaps(shown).correctedFromStart).toBe(0);
    expect(showBackAtStart(shown)).toBe(false);
  });

  test('a single 1 m step is not back at the start', () => {
    const engine = createLiveEngine({ emptySnapshot: mockEngine.getSnapshot(), stepLengthM: 1 });
    engine.pushStep({ t: 500, heading: 90 });
    const shown = engine.getSnapshot();

    expect(isCannedDemo(shown)).toBe(false);
    expect(shown.stepCount).toBe(1);
    expect(gaps(shown).correctedFromStart).toBeCloseTo(1, 6);
    expect(loopClosureCounts(shown.correctedPath)).toBe(false);
    expect(showBackAtStart(shown)).toBe(false);
  });

  test('shows when a walk of at least 8 m ends exactly 3 m from the path start', () => {
    const engine = createLiveEngine({ stepLengthM: 1 });
    east(engine, 6);
    for (let index = 0; index < 3; index += 1) {
      engine.pushStep({ t: 4000 + (index + 1) * 500, heading: 270 });
    }
    const shown = engine.getSnapshot();

    expect(shown.stepCount).toBe(9);
    expect(gaps(shown).correctedFromStart).toBeCloseTo(3, 6);
    expect(showBackAtStart(shown)).toBe(true);
  });

  test('hides when the corrected end is farther than 3 m from the path start', () => {
    const engine = createLiveEngine({ stepLengthM: 1 });
    east(engine, 8);
    const shown = engine.getSnapshot();

    expect(shown.stepCount).toBe(8);
    expect(gaps(shown).correctedFromStart).toBeCloseTo(8, 6);
    expect(showBackAtStart(shown)).toBe(false);
  });

  test('measures that gap from the path start when the walk did not begin at the world origin', () => {
    const engine = createLiveEngine({ originX: 20, originY: -4, stepLengthM: 1 });
    const headings = [
      ...Array<number>(4).fill(0),
      ...Array<number>(4).fill(90),
      ...Array<number>(4).fill(180),
      ...Array<number>(3).fill(270),
    ];
    headings.forEach((heading, index) => {
      engine.pushStep({ t: (index + 1) * 500, heading });
    });
    const shown = engine.getSnapshot();
    const end = shown.correctedPath.at(-1)!;

    expect(shown.correctedPath[0]).toMatchObject({ x: 20, y: -4 });
    expect(gaps(shown).correctedFromStart).toBeCloseTo(1, 6);
    expect(Math.hypot(end.x, end.y)).toBeGreaterThan(3);
    expect(showBackAtStart(shown)).toBe(true);
  });

  test('a rectangular loop still counts and still closes on the start', () => {
    const engine = createLiveEngine({ stepLengthM: 1, drift: { corridor: false } });
    const headings = [
      ...Array<number>(4).fill(0),
      ...Array<number>(6).fill(90),
      ...Array<number>(4).fill(180),
      ...Array<number>(4).fill(270),
    ];
    headings.forEach((heading, index) => {
      engine.pushStep({ t: (index + 1) * 500, heading });
    });
    const shown = engine.getSnapshot();
    const start = shown.correctedPath[0]!;

    expect(shown.stepCount).toBe(18);
    expect(gaps(shown).correctedFromStart).toBeCloseTo(2, 6);
    expect(loopClosureCounts(shown.correctedPath)).toBe(true);
    expect(showBackAtStart(shown)).toBe(true);

    const closed = closeLoop(shown.correctedPath);
    const end = closed.at(-1)!;
    expect(closed[0]).toEqual(start);
    expect(Math.hypot(end.x - start.x, end.y - start.y)).toBeLessThan(1e-9);
  });

  test('follows the corrected end when the raw end is somewhere else', () => {
    const nearCorrected: EngineSnapshot = {
      rawPath: [
        { x: 0, y: 0, t: 0 },
        { x: 10, y: 0, t: 500 },
      ],
      correctedPath: [
        { x: 0, y: 0, t: 0 },
        { x: 0, y: 6, t: 500 },
        { x: 2, y: 6, t: 1000 },
        { x: 2, y: 0, t: 1500 },
      ],
      stepCount: 3,
      heading: 90,
      pins: [],
      pitchPaused: false,
    };
    const farCorrected: EngineSnapshot = {
      ...nearCorrected,
      rawPath: [
        { x: 0, y: 0, t: 0 },
        { x: 1, y: 0, t: 500 },
      ],
      correctedPath: [
        { x: 0, y: 0, t: 0 },
        { x: 0, y: 6, t: 500 },
        { x: 10, y: 6, t: 1000 },
        { x: 10, y: 0, t: 1500 },
      ],
    };

    expect(showBackAtStart(nearCorrected)).toBe(true);
    expect(showBackAtStart(farCorrected)).toBe(false);
  });
});

describe('back at start', () => {
  test('the control closes the corrected end on the start and leaves the raw end', () => {
    const engine = createLiveEngine({ stepLengthM: 1 });
    engine.addPin(desk);
    east(engine, 4);
    const setDrift = jest.spyOn(engine, 'setDrift');
    const before = engine.getSnapshot();

    const hold = assertBackAtStart(engine, before);

    expect(hold).toEqual({ stepCount: 4 });
    expect(setDrift).toHaveBeenCalledTimes(1);
    expect(setDrift).toHaveBeenCalledWith({ closeLoop: true });
    const closed = engine.getSnapshot();
    const gap = gaps(closed);
    expect(gap.correctedFromStart).toBeLessThan(1e-6);
    expect(gap.rawFromStart).toBeGreaterThan(1);
    expect(closed.rawPath.at(-1)).toEqual(before.rawPath.at(-1));
    expect(closed.pins).toEqual([desk]);
  });

  test('the next step clears closure so the new end stays where that step landed', () => {
    const engine = createLiveEngine({ stepLengthM: 1 });
    east(engine, 4);
    const hold = assertBackAtStart(engine, engine.getSnapshot());
    if (!hold) throw new Error('expected a hold');
    const setDrift = jest.spyOn(engine, 'setDrift');

    const same = releaseBackAtStart(engine, hold, engine.getSnapshot());
    expect(same).toEqual({ hold, readAgain: false });
    expect(setDrift).not.toHaveBeenCalled();

    east(engine, 1, 2000);
    const stepped = engine.getSnapshot();
    expect(gaps(stepped).correctedFromStart).toBeLessThan(1e-6);

    const released = releaseBackAtStart(engine, hold, stepped);
    expect(released).toEqual({ hold: null, readAgain: true });
    expect(setDrift).toHaveBeenCalledTimes(1);
    expect(setDrift).toHaveBeenCalledWith({ closeLoop: false });

    const open = engine.getSnapshot();
    const gap = gaps(open);
    expect(gap.correctedFromStart).toBeGreaterThan(4);
    expect(gap.rawFromCorrected).toBeLessThan(1e-6);
  });

  test('a saved floor neither accepts the assertion nor clears one already held', () => {
    const engine = createLiveEngine({ stepLengthM: 1 });
    east(engine, 4);
    const hold = assertBackAtStart(engine, engine.getSnapshot());
    if (!hold) throw new Error('expected a hold');
    const setDrift = jest.spyOn(engine, 'setDrift');
    const saved: EngineSnapshot = {
      rawPath: [
        { x: 0, y: 0, t: 0 },
        { x: 8, y: 0, t: 10 },
      ],
      correctedPath: [
        { x: 0, y: 0, t: 0 },
        { x: 8, y: 0, t: 10 },
      ],
      stepCount: 20,
      heading: 90,
      pins: [],
      pitchPaused: false,
    };

    engine.recallSnapshot(saved);
    expect(assertBackAtStart(engine, engine.getSnapshot())).toBeNull();
    expect(releaseBackAtStart(engine, hold, engine.getSnapshot())).toEqual({
      hold,
      readAgain: false,
    });
    expect(setDrift).not.toHaveBeenCalled();

    engine.clearRecall();
    expect(gaps(engine.getSnapshot()).correctedFromStart).toBeLessThan(1e-6);
  });

  test('the demo does not arm closure for the steps that follow', () => {
    const demo = mockEngine.getSnapshot();
    const engine = createLiveEngine({ emptySnapshot: demo, stepLengthM: 1 });

    expect(assertBackAtStart(engine, engine.getSnapshot())).toBeNull();
    east(engine, 1);
    const gap = gaps(engine.getSnapshot());
    expect(gap.correctedFromStart).toBeGreaterThan(0.5);
    expect(gap.rawFromCorrected).toBeLessThan(1e-6);
  });
});
