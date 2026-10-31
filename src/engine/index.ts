import {
  createLiveEngine,
  type LandmarkPin,
  type LiveEngineConfig,
  type LiveFloorwalkerEngine,
} from '@/engine/live-engine';

/**
 * Process-wide live engine. Push samples, then read `getSnapshot()`.
 * Tests build an isolated engine with `createLiveEngine()`.
 * `mockEngine` is the canned walk.
 */
const liveEngine = createLiveEngine();

export function getEngine(): LiveFloorwalkerEngine {
  return liveEngine;
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

export { mockEngine } from '@/engine/mock-engine';
