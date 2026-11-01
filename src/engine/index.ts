import {
  createLiveEngine,
  type LandmarkPin,
  type LiveEngineConfig,
  type LiveFloorwalkerEngine,
} from '@/engine/live-engine';
import { mockEngine } from '@/engine/mock-engine';
import type { StartSensorFeedOptions } from '@/engine/sensor-feed';

/**
 * Process-wide live engine. `startSensors` / `stopSensors` subscribe it.
 * Until the first finite sample, `getSnapshot` is the static demo from
 * `mockEngine`, which stays exported. `snapshotForSave` is the empty
 * recording until a real sample or a recalled floor replaces that picture.
 * Tests build an isolated engine with `createLiveEngine()`.
 *
 * One feed. The screen that calls `startSensors` owns `stopSensors`.
 * Walk does that on focus and blur. Map and Library only read the
 * snapshot, so they must not stop the feed. Calibration borrows the same
 * feed for its own walk, and only while Walk is not the focused owner.
 * A second `startSensors` does nothing while the feed is up. `stopSensors`
 * always releases it.
 */
const liveEngine = createLiveEngine({ emptySnapshot: mockEngine.getSnapshot() });

export function getEngine(): LiveFloorwalkerEngine {
  return liveEngine;
}

export function getLiveEngine(): LiveFloorwalkerEngine {
  return liveEngine;
}

export function startSensors(options?: StartSensorFeedOptions): Promise<void> {
  return liveEngine.startSensors(options);
}

export function stopSensors(): void {
  liveEngine.stopSensors();
}

export { createLiveEngine };
export type { LandmarkPin, LiveEngineConfig, LiveFloorwalkerEngine };

export type { EngineSnapshot, FloorwalkerEngine, PathPoint, Pin } from '@/engine/types';

export {
  DEFAULT_STEP_DETECTOR_CONFIG,
  STANDARD_GRAVITY_MPS2,
  accelerationMagnitude,
  countSteps,
  detectSteps,
} from '@/engine/step-detector';
export type {
  AccelMagnitudeSample,
  AccelSample,
  StepDetectorConfig,
  StepEvent,
  StepSample,
} from '@/engine/step-detector';

export {
  DEFAULT_HEADING_FUSION_CONFIG,
  fuseHeading,
  magneticFieldMagnitude,
  magneticHeadingDeg,
} from '@/engine/heading-fusion';
export type {
  FusedHeading,
  GyroSample,
  HeadingFusionConfig,
  MagSample,
} from '@/engine/heading-fusion';

export {
  DEFAULT_PATH_INTEGRATION_CONFIG,
  DEFAULT_STEP_LENGTH_M,
  integratePath,
  stepOffset,
} from '@/engine/path-integration';
export type { HeadingSample, PathIntegrationConfig, PathStep } from '@/engine/path-integration';

export {
  countCalibrationSteps,
  estimateStepLength,
  estimateStepLengthFromSteps,
  stepLengthOrDefault,
} from '@/engine/step-length';
export type { CalibrationWalk, StepLengthEstimate } from '@/engine/step-length';

export {
  CORRIDOR_AXES_DEG,
  DEFAULT_CORRIDOR_SNAP_CONFIG,
  alignLandmarks,
  closeLoop,
  correctDrift,
  nearestCorridorAxis,
  snapCorridor,
} from '@/engine/drift-correction';
export type {
  CorridorAxis,
  CorridorSnapConfig,
  DriftCorrection,
  DriftCorrectionOptions,
  LandmarkTag,
} from '@/engine/drift-correction';

export { emptyRecording, isCannedDemo, mockEngine } from '@/engine/mock-engine';

export {
  FLAT_SCREEN_UP_DOWN,
  GRAVITY_LOWPASS_TAU_S,
  LEVEL_MAX_TILT_FROM_HORIZONTAL_DEG,
  attitudeIsLevel,
  levelMagnetometer,
  smoothGravity,
  tiltFromHorizontalDeg,
  worldDown,
  yawAboutDown,
} from '@/engine/level-attitude';
export type { AccelAtRest, Vec3 } from '@/engine/level-attitude';

export {
  DEFAULT_SENSOR_UPDATE_INTERVAL_MS,
  loadExpoMotionSensors,
  startSensorFeed,
} from '@/engine/sensor-feed';
export type {
  MotionSensor,
  MotionSensors,
  SensorFeed,
  SensorFeedSink,
  SensorMeasurement,
  SensorSubscription,
  StartSensorFeedOptions,
} from '@/engine/sensor-feed';
