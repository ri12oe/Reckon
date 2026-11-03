/**
 * UI-side contract for the dead-reckoning engine.
 *
 * Points are meters on the floor plane: x east, y north.
 * t is milliseconds from the start of the walk.
 * heading is degrees clockwise from north.
 *
 * `getEngine()` is the live pipeline. Until that shared engine accepts a
 * sample it still serves the static demo snapshot. `mockEngine` stays exported.
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

/**
 * Why the latest `startSensors` did not subscribe to both the accelerometer
 * and the gyroscope. `permission` is a denial. `unavailable` means a required
 * sensor reported itself missing. `error` means the Expo call threw.
 */
export type SensorStartFault = 'permission' | 'unavailable' | 'error';

export type EngineSnapshot = {
  rawPath: PathPoint[];
  correctedPath: PathPoint[];
  stepCount: number;
  heading: number;
  pins: Pin[];
  /**
   * True only while the running feed's latest directed, gravity-trusted
   * accel sample made `attitudeIsLevel` return false. False for a level
   * pose, free-fall, a sample before gravity is trusted, a missing or
   * stopped feed, the canned demo, a recalled floor, and `snapshotForSave()`.
   * Not a SQLite column. The angle stays `LEVEL_MAX_TILT_FROM_HORIZONTAL_DEG`
   * inside `attitudeIsLevel`.
   */
  pitchPaused: boolean;
  /**
   * Present when `heading` is the latest fused sample.
   * True while that sample is gyro propagation, including a magnetic hold.
   * Omitted when the heading did not come from fusion.
   * `getSnapshot` and `snapshotForSave` keep it on a live or recalled walk.
   */
  gyroOnly?: boolean;
  sensorStartFailed?: SensorStartFault;
  /**
   * The static demo picture, not a walk. `snapshotForSave` replaces it
   * with an empty recording. A screen that summarizes a save must refuse
   * this snapshot and show that recording instead.
   */
  isCannedDemo?: true;
};

export type FloorwalkerEngine = {
  getSnapshot(): EngineSnapshot;
};
