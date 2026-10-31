import type { EngineSnapshot, PathPoint, Pin } from '@/engine';

export type HeldPin = {
  id: string;
  label: string;
};

export type WalkPinRead = {
  held: HeldPin[];
  commit: Pin[];
  shown: EngineSnapshot;
};

function pathEnd(snapshot: EngineSnapshot): { x: number; y: number } | null {
  const point = snapshot.correctedPath.at(-1);
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
  return { x: point.x, y: point.y };
}

function samePoint(a: PathPoint, b: PathPoint): boolean {
  return a.x === b.x && a.y === b.y && a.t === b.t;
}

function samePin(a: Pin, b: Pin): boolean {
  return a.id === b.id && a.label === b.label && a.x === b.x && a.y === b.y;
}

function isDemoSnapshot(snapshot: EngineSnapshot, demo: EngineSnapshot): boolean {
  if (snapshot.stepCount !== demo.stepCount || snapshot.heading !== demo.heading) return false;
  if (snapshot.rawPath.length !== demo.rawPath.length) return false;
  if (snapshot.correctedPath.length !== demo.correctedPath.length) return false;
  if (snapshot.pins.length !== demo.pins.length) return false;
  for (let i = 0; i < snapshot.rawPath.length; i += 1) {
    if (!samePoint(snapshot.rawPath[i]!, demo.rawPath[i]!)) return false;
  }
  for (let i = 0; i < snapshot.correctedPath.length; i += 1) {
    if (!samePoint(snapshot.correctedPath[i]!, demo.correctedPath[i]!)) return false;
  }
  for (let i = 0; i < snapshot.pins.length; i += 1) {
    if (!samePin(snapshot.pins[i]!, demo.pins[i]!)) return false;
  }
  return true;
}

type WalkSource = 'demo' | 'live' | 'recalled';

function walkSource(snapshot: EngineSnapshot, demo: EngineSnapshot, recalled: boolean): WalkSource {
  if (recalled) return 'recalled';
  if (isDemoSnapshot(snapshot, demo)) return 'demo';
  return 'live';
}

function place(pins: readonly HeldPin[], at: { x: number; y: number }): Pin[] {
  return pins.map((pin) => ({ id: pin.id, label: pin.label, x: at.x, y: at.y }));
}

function showHeld(snapshot: EngineSnapshot, held: readonly HeldPin[]): EngineSnapshot {
  const at = pathEnd(snapshot);
  if (!at || held.length === 0) return snapshot;
  return { ...snapshot, pins: [...snapshot.pins, ...place(held, at)] };
}

function finish(
  snapshot: EngineSnapshot,
  demo: EngineSnapshot,
  recalled: boolean,
  held: readonly HeldPin[],
  extra: HeldPin | null,
): WalkPinRead {
  const source = walkSource(snapshot, demo, recalled);
  if (source === 'recalled') {
    return { held: [...held], commit: [], shown: snapshot };
  }
  if (source === 'demo') {
    const next = extra ? [...held, extra] : [...held];
    return { held: next, commit: [], shown: showHeld(snapshot, next) };
  }
  const at = pathEnd(snapshot);
  const waiting = extra ? [...held, extra] : [...held];
  if (!at || waiting.length === 0) {
    return { held: [...held], commit: [], shown: snapshot };
  }
  const commit = place(waiting, at);
  return {
    held: [],
    commit,
    shown: { ...snapshot, pins: [...snapshot.pins, ...commit] },
  };
}

export function readWalk(
  snapshot: EngineSnapshot,
  demo: EngineSnapshot,
  recalled: boolean,
  held: readonly HeldPin[],
): WalkPinRead {
  return finish(snapshot, demo, recalled, held, null);
}

export function dropWalkPin(
  snapshot: EngineSnapshot,
  demo: EngineSnapshot,
  recalled: boolean,
  held: readonly HeldPin[],
  pin: HeldPin,
): WalkPinRead {
  return finish(snapshot, demo, recalled, held, pin);
}
