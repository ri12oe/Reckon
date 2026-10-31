import type { StoredFloor } from '@/db/floors';
import { getEngine } from '@/engine';

export type ActiveFloor = {
  id: string;
  buildingName: string;
  name: string;
};

let active: ActiveFloor | null = null;

export function getActiveFloor(): ActiveFloor | null {
  return active ? { ...active } : null;
}

/** Park a saved snapshot on the engine so Walk and Map render it. */
export function showSavedFloor(floor: StoredFloor): void {
  getEngine().recallSnapshot(floor.snapshot);
  active = { id: floor.id, buildingName: floor.buildingName, name: floor.name };
}

export function resumeLiveWalk(): void {
  getEngine().clearRecall();
  active = null;
}
