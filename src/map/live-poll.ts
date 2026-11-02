import { getEngine, type EngineSnapshot } from '@/engine';

export function createMapPoll(): () => EngineSnapshot {
  const engine = getEngine();
  return () => engine.getSnapshot();
}
