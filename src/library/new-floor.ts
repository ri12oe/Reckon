import { resumeLiveWalk } from '@/db/session';
import { getEngine, type EngineSnapshot } from '@/engine';
import { snapshotForSaveCard } from '@/library/save-card';

export function startNewFloor(): EngineSnapshot {
  resumeLiveWalk();
  const engine = getEngine();
  engine.reset();
  return snapshotForSaveCard(engine);
}
