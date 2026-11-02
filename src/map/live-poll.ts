import { getEngine, type EngineSnapshot } from '@/engine';

export function createMapPoll(): () => EngineSnapshot {
  return () => getEngine().getSnapshot();
}
