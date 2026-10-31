import { mockEngine } from '@/engine/mock-engine';
import type { FloorwalkerEngine } from '@/engine/types';

export function getEngine(): FloorwalkerEngine {
  return mockEngine;
}

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
