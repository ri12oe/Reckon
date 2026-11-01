/**
 * UI-side contract for the dead-reckoning engine.
 *
 * Points are meters on the floor plane: x east, y north.
 * t is milliseconds from the start of the walk.
 * heading is degrees clockwise from north.
 *
 * `getEngine()` is the live pipeline. Until that shared engine accepts a
 * sample it still serves the static demo snapshot for display.
 * `snapshotForSave` is the recording, and it is empty during that demo.
 * `mockEngine` stays exported.
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
