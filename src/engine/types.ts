/**
 * UI-side contract for the dead-reckoning engine.
 * `getEngine()` is the live pipeline. `mockEngine` is the static sample walk.
 *
 * Points are meters on the floor plane: x east, y north.
 * t is milliseconds from the start of the walk.
 * heading is degrees clockwise from north.
 */

export type PathPoint = {
  x: number;
  y: number;
  t: number;
};

export type Pin = {
  id: string;
  x: number;
  y: number;
  label: string;
};

export type EngineSnapshot = {
  rawPath: PathPoint[];
  correctedPath: PathPoint[];
  stepCount: number;
  heading: number;
  pins: Pin[];
};

export type FloorwalkerEngine = {
  getSnapshot(): EngineSnapshot;
};
