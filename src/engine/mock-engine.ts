import type { EngineSnapshot, FloorwalkerEngine } from '@/engine/types';

const snapshot: EngineSnapshot = {
  rawPath: [
    { x: 0, y: 0, t: 0 },
    { x: 1.2, y: 0.4, t: 1200 },
    { x: 2.4, y: -0.2, t: 2400 },
    { x: 3.6, y: 0.5, t: 3600 },
    { x: 4.2, y: 1.7, t: 4800 },
    { x: 3.7, y: 3.1, t: 6000 },
    { x: 4.6, y: 4.4, t: 7200 },
  ],
  correctedPath: [
    { x: 0, y: 0, t: 0 },
    { x: 1.5, y: 0, t: 1200 },
    { x: 3, y: 0, t: 2400 },
    { x: 4.5, y: 0, t: 3600 },
    { x: 4.5, y: 1.5, t: 4800 },
    { x: 4.5, y: 3, t: 6000 },
    { x: 4.5, y: 4.5, t: 7200 },
  ],
  stepCount: 12,
  heading: 90,
  pins: [
    { id: 'door', x: 4.5, y: 1.5, label: 'door' },
    { id: 'desk', x: 4.5, y: 4.5, label: 'desk' },
  ],
};

export const mockEngine: FloorwalkerEngine = {
  getSnapshot() {
    return snapshot;
  },
};
