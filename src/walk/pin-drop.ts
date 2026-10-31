import type { EngineSnapshot, Pin } from '@/engine';

/** A pin the Walk screen has dropped and not yet sent to the engine. */
export type HeldPin = {
  id: string;
  label: string;
};

export type WalkPinRead = {
  held: HeldPin[];
  /** Pins to pass to `addPin`. Empty while the engine is still on the demo. */
  commit: Pin[];
  /** Snapshot for the canvas. Includes held pins only while the demo is showing. */
  shown: EngineSnapshot;
};

export function dropWalkPin(
  snapshot: EngineSnapshot,
  _demo: EngineSnapshot,
  _recalled: boolean,
  held: readonly HeldPin[],
  pin: HeldPin,
): WalkPinRead {
  const point = snapshot.correctedPath.at(-1);
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    return { held: [...held], commit: [], shown: snapshot };
  }
  return {
    held: [...held],
    commit: [{ id: pin.id, label: pin.label, x: point.x, y: point.y }],
    shown: snapshot,
  };
}

export function readWalk(
  snapshot: EngineSnapshot,
  _demo: EngineSnapshot,
  _recalled: boolean,
  held: readonly HeldPin[],
): WalkPinRead {
  return { held: [...held], commit: [], shown: snapshot };
}
