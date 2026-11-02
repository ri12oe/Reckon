import { isCannedDemo, type EngineSnapshot, type LiveFloorwalkerEngine } from '@/engine';

type LoopEngine = Pick<LiveFloorwalkerEngine, 'setDrift' | 'isRecalled'>;

/** Step count of the live walk when the walker said they were back. */
export type LoopHold = {
  stepCount: number;
};

export type LoopRelease = {
  hold: LoopHold | null;
  /**
   * The snapshot still had closure on after a newer step, so that read
   * pulled the new end back to the start. Read again after this returns.
   */
  readAgain: boolean;
};

/** Meters. The corrected end is close enough to the path start to offer closure. */
const NEAR_START_M = 3;

export function showBackAtStart(shown: EngineSnapshot): boolean {
  if (isCannedDemo(shown) || shown.stepCount <= 0) return false;
  const start = shown.correctedPath[0] ?? { x: 0, y: 0 };
  const end = shown.correctedPath.at(-1);
  if (!end) return false;
  return Math.hypot(end.x - start.x, end.y - start.y) <= NEAR_START_M;
}

/**
 * The walker says this end is the start. Later snapshots spread the gap
 * back along the corrected path. A canned demo or a recalled floor has
 * no live end to close, and arming the flag there would close the next
 * live steps instead.
 */
export function assertBackAtStart(engine: LoopEngine, shown: EngineSnapshot): LoopHold | null {
  if (shown.isCannedDemo || engine.isRecalled()) return null;
  engine.setDrift({ closeLoop: true });
  return { stepCount: shown.stepCount };
}

/**
 * A step past the assertion means they kept walking. Clear the flag.
 * Leaving it on pulls every new end back to the start and squashes the path.
 * A recalled floor keeps the assertion underneath. A reset shows the demo
 * again and drops the mark. `reset()` already turned the flag off.
 */
export function releaseBackAtStart(
  engine: LoopEngine,
  hold: LoopHold | null,
  shown: EngineSnapshot,
): LoopRelease {
  if (!hold || engine.isRecalled()) return { hold, readAgain: false };
  if (shown.isCannedDemo) return { hold: null, readAgain: false };
  if (shown.stepCount <= hold.stepCount) return { hold, readAgain: false };
  engine.setDrift({ closeLoop: false });
  return { hold: null, readAgain: true };
}
