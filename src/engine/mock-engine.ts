import type { EngineSnapshot, FloorwalkerEngine, PathPoint, Pin } from '@/engine/types';

const snapshot: EngineSnapshot = {
  rawPath: [
    { x: 0, y: 0, t: 0 },
    { x: 1.2, y: 0.4, t: 1200 },
    { x: 2.4, y: -0.2, t: 2400 },
    { x: 3.6, y: 0.5, t: 3600 },
    { x: 4.2, y: 1.7, t: 4800 },
    { x: 3.7, y: 3.1, t: 6000 },
    { x: 4.6, y: 4.4, t: 7200 },
  ],
  correctedPath: [
    { x: 0, y: 0, t: 0 },
    { x: 1.5, y: 0, t: 1200 },
    { x: 3, y: 0, t: 2400 },
    { x: 4.5, y: 0, t: 3600 },
    { x: 4.5, y: 1.5, t: 4800 },
    { x: 4.5, y: 3, t: 6000 },
    { x: 4.5, y: 4.5, t: 7200 },
  ],
  stepCount: 12,
  heading: 90,
  pins: [
    { id: 'door', x: 4.5, y: 1.5, label: 'door' },
    { id: 'desk', x: 4.5, y: 4.5, label: 'desk' },
  ],
};

export const mockEngine: FloorwalkerEngine = {
  getSnapshot() {
    return snapshot;
  },
};

/** A walk with no samples. Save and export use this in place of the canned demo. */
export function emptyRecording(): EngineSnapshot {
  return {
    rawPath: [{ x: 0, y: 0, t: 0 }],
    correctedPath: [{ x: 0, y: 0, t: 0 }],
    stepCount: 0,
    heading: 0,
    pins: [],
  };
}

/** True when `snapshot` is the static demo, not a recorded walk. */
export function isCannedDemo(snapshot: EngineSnapshot): boolean {
  return sameSnapshot(snapshot, mockEngine.getSnapshot());
}

function sameSnapshot(a: EngineSnapshot, b: EngineSnapshot): boolean {
  if (a.stepCount !== b.stepCount || a.heading !== b.heading) return false;
  if (a.rawPath.length !== b.rawPath.length || a.correctedPath.length !== b.correctedPath.length) {
    return false;
  }
  if (a.pins.length !== b.pins.length) return false;
  for (let i = 0; i < a.rawPath.length; i += 1) {
    if (!samePoint(a.rawPath[i]!, b.rawPath[i]!)) return false;
  }
  for (let i = 0; i < a.correctedPath.length; i += 1) {
    if (!samePoint(a.correctedPath[i]!, b.correctedPath[i]!)) return false;
  }
  for (let i = 0; i < a.pins.length; i += 1) {
    if (!samePin(a.pins[i]!, b.pins[i]!)) return false;
  }
  return true;
}

function samePoint(a: PathPoint, b: PathPoint): boolean {
  return a.x === b.x && a.y === b.y && a.t === b.t;
}

function samePin(a: Pin, b: Pin): boolean {
  return a.id === b.id && a.label === b.label && a.x === b.x && a.y === b.y;
}
