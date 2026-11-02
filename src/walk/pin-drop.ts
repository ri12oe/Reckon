import type { EngineSnapshot, LandmarkPin, PathPoint, Pin } from '@/engine';

export type HeldPin = {
  id: string;
  label: string;
};

export type WalkPinRead = {
  held: HeldPin[];
  commit: LandmarkPin[];
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

function withDrop(held: readonly HeldPin[], extra: HeldPin | null): HeldPin[] {
  if (!extra || held.some((pin) => pin.id === extra.id)) return [...held];
  return [...held, extra];
}

function drawPins(existing: readonly Pin[], added: readonly Pin[]): Pin[] {
  const seen = new Set(existing.map((pin) => pin.id));
  const pins = [...existing];
  for (const pin of added) {
    if (seen.has(pin.id)) continue;
    seen.add(pin.id);
    pins.push(pin);
  }
  return pins;
}

function showHeld(snapshot: EngineSnapshot, held: readonly HeldPin[]): EngineSnapshot {
  const at = pathEnd(snapshot);
  if (!at || held.length === 0) return snapshot;
  return { ...snapshot, pins: drawPins(snapshot.pins, place(held, at)) };
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
  const waiting = withDrop(held, extra);
  if (source === 'demo') {
    return { held: waiting, commit: [], shown: showHeld(snapshot, waiting) };
  }
  const at = pathEnd(snapshot);
  if (!at || waiting.length === 0) {
    return { held: [...held], commit: [], shown: snapshot };
  }
  const commit = waiting.map((pin) => ({ id: pin.id, label: pin.label }));
  return {
    held: [],
    commit,
    shown: { ...snapshot, pins: drawPins(snapshot.pins, place(waiting, at)) },
  };
}

export function commitWalkPins(
  engine: { tagLandmark(tag: LandmarkPin): void },
  read: WalkPinRead,
): void {
  for (const tag of read.commit) engine.tagLandmark(tag);
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

export type OpenLandmark = {
  pin: HeldPin | null;
  count: number;
};

export function emptyLandmark(): OpenLandmark {
  return { pin: null, count: 0 };
}

function pinToDrop(open: OpenLandmark): { pin: HeldPin; open: OpenLandmark } {
  if (open.pin) return { pin: open.pin, open };
  const count = open.count + 1;
  const pin = { id: `pin-${count}`, label: `Pin ${count}` };
  return { pin, open: { pin, count } };
}

export function newLandmark(open: OpenLandmark): OpenLandmark {
  if (open.pin === null) return open;
  return { pin: null, count: open.count };
}

export function dropLandmark(
  open: OpenLandmark,
  snapshot: EngineSnapshot,
  demo: EngineSnapshot,
  recalled: boolean,
  held: readonly HeldPin[],
): { open: OpenLandmark; read: WalkPinRead; placed: boolean } {
  const next = pinToDrop(open);
  const read = dropWalkPin(snapshot, demo, recalled, held, next.pin);
  const placed = read.commit.length > 0 || read.held.length > held.length;
  return { open: placed ? next.open : open, read, placed };
}
