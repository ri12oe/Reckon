import { getEngine, mockEngine, type LiveFloorwalkerEngine } from '@/engine';
import { readWalk, type HeldPin, type WalkPinRead } from '@/walk/pin-drop';

export type LiveWalkFrame = {
  engine: LiveFloorwalkerEngine;
  view: WalkPinRead;
};

export function createWalkPoll(): (held: readonly HeldPin[]) => LiveWalkFrame {
  return (held) => {
    const engine = getEngine();
    return {
      engine,
      view: readWalk(engine.getSnapshot(), mockEngine.getSnapshot(), engine.isRecalled(), held),
    };
  };
}
