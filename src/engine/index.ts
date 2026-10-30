import { mockEngine } from '@/engine/mock-engine';
import type { FloorwalkerEngine } from '@/engine/types';

export function getEngine(): FloorwalkerEngine {
  return mockEngine;
}

export type { EngineSnapshot, FloorwalkerEngine, PathPoint, Pin } from '@/engine/types';
