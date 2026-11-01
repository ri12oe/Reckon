import { calibrationDatabaseOpen, readStepLength } from '@/db/calibration';
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
 * `mockEngine`, which stays exported. Tests build an isolated engine
 * with `createLiveEngine()`.
 *
 * A saved step length is applied once the database is open. Web opens
 * that database after the first render, so a later `getEngine` call
 * picks the length up.
 */
let liveEngine: LiveFloorwalkerEngine | null = null;
let bootedWithDatabase = false;

function storedStepLengthM(): number | undefined {
  if (!calibrationDatabaseOpen()) return undefined;
  return readStepLength()?.stepLengthM;
}

function bootConfig(): LiveEngineConfig {
  const stepLengthM = storedStepLengthM();
  return {
    emptySnapshot: mockEngine.getSnapshot(),
    ...(stepLengthM !== undefined ? { stepLengthM } : {}),
  };
}

export function getEngine(): LiveFloorwalkerEngine {
  const existing = liveEngine;
  if (existing) {
    if (!bootedWithDatabase && calibrationDatabaseOpen()) {
      const stepLengthM = storedStepLengthM();
      if (stepLengthM !== undefined) existing.setStepLength(stepLengthM);
      bootedWithDatabase = true;
    }
    return existing;
  }
  const created = createLiveEngine(bootConfig());
  liveEngine = created;
  bootedWithDatabase = calibrationDatabaseOpen();
  return created;
}

export function getLiveEngine(): LiveFloorwalkerEngine {
  return getEngine();
}

export function startSensors(options?: StartSensorFeedOptions): Promise<void> {
  return getEngine().startSensors(options);
}

export function stopSensors(): void {
  liveEngine?.stopSensors();
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
  YawBrake,
  YawMeasurement,
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
