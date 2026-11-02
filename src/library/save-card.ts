import type { EngineSnapshot } from '@/engine';

type SaveCardEngine = {
  getSnapshot(): EngineSnapshot;
  snapshotForSave(): EngineSnapshot;
};

export function snapshotForSaveCard(engine: SaveCardEngine): EngineSnapshot {
  const shown = engine.getSnapshot();
  if (shown.isCannedDemo) return engine.snapshotForSave();
  return shown;
}
