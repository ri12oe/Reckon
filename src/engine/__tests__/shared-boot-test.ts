import { createLiveEngine, getEngine } from '@/engine';
import type { PathPoint } from '@/engine/types';

function expectPoint(point: PathPoint, x: number, y: number, t: number, digits = 9): void {
  expect(point.t).toBe(t);
  expect(point.x).toBeCloseTo(x, digits);
  expect(point.y).toBeCloseTo(y, digits);
}

function walkTenDegreeHall(engine: {
  setStepLength(stepLengthM: number): void;
  pushStep(step: { t: number; heading: number }): void;
}): void {
  engine.setStepLength(1);
  for (const [index, heading] of [10, 10, 10, 10].entries()) {
    engine.pushStep({ t: (index + 1) * 500, heading });
  }
}

describe('shared engine boot', () => {
  test('getEngine snaps a 10° hall onto north and leaves the raw end at (0.695, 3.939)', () => {
    const engine = getEngine();
    walkTenDegreeHall(engine);
    const snapshot = engine.getSnapshot();

    expect(snapshot.stepCount).toBe(4);
    expect(snapshot.heading).toBe(10);
    expectPoint(snapshot.rawPath[2]!, 0.347296355334, 1.969615506024, 1000);
    expectPoint(snapshot.rawPath[4]!, 0.694592710668, 3.939231012049, 2000);
    expect(snapshot.correctedPath[2]!.x).toBe(0);
    expect(snapshot.correctedPath[2]!.y).toBeCloseTo(2, 9);
    expect(snapshot.correctedPath[2]!.t).toBe(1000);
    expect(snapshot.correctedPath[4]!.x).toBe(0);
    expect(snapshot.correctedPath[4]!.y).toBeCloseTo(4, 9);
    expect(snapshot.correctedPath[4]!.t).toBe(2000);
  });

  test('createLiveEngine without drift leaves the same 10° hall unsnapped', () => {
    const engine = createLiveEngine();
    walkTenDegreeHall(engine);
    const snapshot = engine.getSnapshot();

    expect(snapshot.stepCount).toBe(4);
    expect(snapshot.heading).toBe(10);
    expect(snapshot.correctedPath).toEqual(snapshot.rawPath);
    expectPoint(snapshot.rawPath[4]!, 0.694592710668, 3.939231012049, 2000);
  });
});
