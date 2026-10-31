/**
 * Live pedestrian dead-reckoning engine.
 *
 * Composes the pure modules. This file does not reimplement their math
 * and it does not read a device:
 *
 * 1. Accelerometer samples → `detectSteps`.
 * 2. Gyroscope and magnetometer samples → `fuseHeading`.
 * 3. `estimateStepLength` when the caller calibrates a known distance.
 * 4. `integratePath` → the raw walk.
 * 5. `correctDrift` → the corrected walk (corridor snap by default).
 *
 * Samples are pushed in, including from `startSensors` (the Expo motion
 * feed). `getSnapshot()` runs the pipeline. A finite `pushStep` selects
 * the explicit step list and accelerometer peaks are not counted until
 * `reset()`. A step's own heading displaces that step.
 *
 * `emptySnapshot`, when set, is what `getSnapshot` returns until the first
 * finite accel, gyro, mag, step, or heading sample. `reset()` arms it again.
 * The shared engine uses that for the static demo walk.
 * `EngineSnapshot.heading` is the course: the latest fused heading, else
 * the latest pushed heading, else the latest step heading, else the
 * configured initial heading (0°).
 *
 * Corridor snap is on unless `drift.corridor` says otherwise. Loop closure
 * and landmark tags are off until the caller asks. Landmark tags also
 * become pins, sitting on the corrected path at the earlier tag.
 *
 * `recallSnapshot` shows a saved walk from `getSnapshot` until `clearRecall`
 * or `reset`. It does not run the pipeline. Samples still accumulate and
 * show up again once the saved walk is cleared.
 */

import {
  correctDrift,
  type DriftCorrectionOptions,
  type LandmarkTag,
} from '@/engine/drift-correction';
import {
  fuseHeading,
  type GyroSample,
  type HeadingFusionConfig,
  type MagSample,
} from '@/engine/heading-fusion';
import {
  DEFAULT_STEP_LENGTH_M,
  integratePath,
  type HeadingSample,
  type PathStep,
} from '@/engine/path-integration';
import {
  startSensorFeed,
  type SensorFeed,
  type StartSensorFeedOptions,
} from '@/engine/sensor-feed';
import { detectSteps, type StepDetectorConfig, type StepSample } from '@/engine/step-detector';
import {
  countCalibrationSteps,
  estimateStepLength,
  type StepLengthEstimate,
} from '@/engine/step-length';
import type { EngineSnapshot, FloorwalkerEngine, PathPoint, Pin } from '@/engine/types';

export type LiveEngineConfig = {
  stepDetector?: Partial<StepDetectorConfig>;
  headingFusion?: Partial<HeadingFusionConfig>;
  /** Meters per step before a calibration. Default 0.75. */
  stepLengthM?: number;
  /**
   * Drift passes. Omitting `corridor` snaps with the corridor defaults.
   * `corridor: false` leaves the integrated headings alone.
   */
  drift?: DriftCorrectionOptions;
  /** Origin easting, meters. */
  originX?: number;
  /** Origin northing, meters. */
  originY?: number;
  /** Origin timestamp, milliseconds. */
  originT?: number;
  /**
   * Served by `getSnapshot` until the first finite sample.
   * The shared engine passes the static demo so screens keep that walk
   * until a sensor actually delivers data.
   */
  emptySnapshot?: EngineSnapshot;
};

/** A landmark tag. `pathIndex` defaults to the end of the current walk. */
export type LandmarkPin = {
  id: string;
  pathIndex?: number;
  /** Defaults to `id` when this id has no pin yet. */
  label?: string;
};

export type LiveFloorwalkerEngine = FloorwalkerEngine & {
  pushAccel(sample: StepSample): void;
  pushGyro(sample: GyroSample): void;
  pushMag(sample: MagSample): void;
  /** A finite timestamp selects explicit steps over accelerometer peaks. */
  pushStep(step: PathStep): void;
  pushHeading(sample: HeadingSample): void;
  /** Ignored when `stepLengthM` is not finite. */
  setStepLength(stepLengthM: number): void;
  /**
   * Mean step length for a measured course.
   * `stepCount` defaults to the steps the next snapshot would integrate.
   * A course that cannot produce a length leaves the current length in place.
   */
  calibrateStepLength(distanceM: number, stepCount?: number): StepLengthEstimate | null;
  /** Updates only the fields present on `options`. */
  setDrift(options: DriftCorrectionOptions): void;
  /** Absolute pin. It does not follow the path and it is not a drift anchor. */
  addPin(pin: Pin): void;
  tagLandmark(tag: LandmarkPin): void;
  /** Show a saved walk. Does not recompute the path. */
  recallSnapshot(snapshot: EngineSnapshot): void;
  clearRecall(): void;
  isRecalled(): boolean;
  reset(): void;
  getStepLength(): number;
  startSensors(options?: StartSensorFeedOptions): Promise<void>;
  stopSensors(): void;
};

type PinRecord = Pin & { anchored: boolean };

type DriftState = {
  corridor: DriftCorrectionOptions['corridor'];
  closeLoop: boolean;
  loopTarget: { x: number; y: number } | undefined;
  tags: LandmarkTag[];
  pins: PinRecord[];
};

type Course = { kind: 'series'; samples: HeadingSample[] } | { kind: 'constant'; heading: number };

export function createLiveEngine(config?: LiveEngineConfig): LiveFloorwalkerEngine {
  const stepDetectorConfig = config?.stepDetector ? { ...config.stepDetector } : undefined;
  const headingFusionConfig = config?.headingFusion ? { ...config.headingFusion } : undefined;
  const originX = finiteOr(config?.originX, 0);
  const originY = finiteOr(config?.originY, 0);
  const originT = finiteOr(config?.originT, 0);
  const initialLength = finiteOr(config?.stepLengthM, DEFAULT_STEP_LENGTH_M);
  const initialDrift = seedDrift(config?.drift);
  const emptySnapshot = config?.emptySnapshot;

  const accels: StepSample[] = [];
  const gyros: GyroSample[] = [];
  const mags: MagSample[] = [];
  const explicitSteps: PathStep[] = [];
  const headingSamples: HeadingSample[] = [];
  let stepLengthM = initialLength;
  let drift = cloneDrift(initialDrift);
  let cached: EngineSnapshot | null = null;
  let recalled: EngineSnapshot | null = null;
  let accepted = false;
  let feed: SensorFeed | null = null;
  let starting: Promise<void> | null = null;
  let generation = 0;

  const touch = () => {
    cached = null;
  };

  function currentSteps(): PathStep[] {
    if (explicitSteps.some((step) => Number.isFinite(step.t))) {
      return explicitSteps.map(copyPathStep);
    }
    return detectSteps(accels, stepDetectorConfig).map((step) => ({ t: step.t }));
  }

  function headingCourse(): Course {
    if (gyros.length > 0 || mags.length > 0) {
      const fused = fuseHeading(gyros, mags, headingFusionConfig);
      if (fused.length > 0) {
        return {
          kind: 'series',
          samples: fused.map((sample) => ({ t: sample.t, heading: sample.heading })),
        };
      }
    }
    if (
      headingSamples.some((sample) => Number.isFinite(sample.t) && Number.isFinite(sample.heading))
    ) {
      return { kind: 'series', samples: headingSamples.map(copyHeading) };
    }
    return { kind: 'constant', heading: resolvedInitialHeading(headingFusionConfig) };
  }

  function compute(): EngineSnapshot {
    const steps = currentSteps();
    const course = headingCourse();
    const rawPath = integratePath(
      steps,
      course.kind === 'series' ? course.samples : course.heading,
      {
        stepLength: stepLengthM,
        originX,
        originY,
        originT,
      },
    );
    const corrected = correctDrift(rawPath, driftOptions(drift));
    return {
      rawPath: corrected.raw,
      correctedPath: corrected.corrected,
      stepCount: countCalibrationSteps(steps),
      heading: snapshotHeading(course, steps, headingFusionConfig),
      pins: resolvePins(drift, corrected.corrected),
    };
  }

  const engine: LiveFloorwalkerEngine = {
    pushAccel(sample) {
      accels.push(copyAccel(sample));
      if (accelAccepted(sample)) accepted = true;
      touch();
    },
    pushGyro(sample) {
      gyros.push({ t: sample.t, yawRate: sample.yawRate });
      if (Number.isFinite(sample.t) && Number.isFinite(sample.yawRate)) accepted = true;
      touch();
    },
    pushMag(sample) {
      mags.push({ t: sample.t, x: sample.x, y: sample.y, z: sample.z });
      if (
        Number.isFinite(sample.t) &&
        Number.isFinite(sample.x) &&
        Number.isFinite(sample.y) &&
        Number.isFinite(sample.z)
      ) {
        accepted = true;
      }
      touch();
    },
    pushStep(step) {
      explicitSteps.push(copyPathStep(step));
      if (Number.isFinite(step.t)) accepted = true;
      touch();
    },
    pushHeading(sample) {
      headingSamples.push(copyHeading(sample));
      if (Number.isFinite(sample.t) && Number.isFinite(sample.heading)) accepted = true;
      touch();
    },
    setStepLength(next) {
      if (!Number.isFinite(next)) return;
      stepLengthM = next;
      touch();
    },
    calibrateStepLength(distanceM, stepCount) {
      const count = stepCount === undefined ? countCalibrationSteps(currentSteps()) : stepCount;
      const estimate = estimateStepLength({ distanceM, stepCount: count });
      if (!estimate) return null;
      stepLengthM = estimate.stepLengthM;
      touch();
      return estimate;
    },
    setDrift(options) {
      drift = applyDrift(drift, options);
      touch();
    },
    addPin(pin) {
      const record: PinRecord = {
        id: pin.id,
        x: pin.x,
        y: pin.y,
        label: pin.label,
        anchored: false,
      };
      const index = drift.pins.findIndex((item) => item.id === pin.id);
      if (index === -1) drift.pins.push(record);
      else drift.pins[index] = record;
      touch();
    },
    tagLandmark(tag) {
      const pathIndex =
        tag.pathIndex === undefined ? countCalibrationSteps(currentSteps()) : tag.pathIndex;
      drift.tags.push({ id: tag.id, pathIndex });
      const existing = drift.pins.find((pin) => pin.id === tag.id);
      if (existing) {
        existing.anchored = true;
        if (tag.label !== undefined) existing.label = tag.label;
      } else {
        drift.pins.push({
          id: tag.id,
          x: 0,
          y: 0,
          label: tag.label ?? tag.id,
          anchored: true,
        });
      }
      touch();
    },
    recallSnapshot(snapshot) {
      recalled = cloneSnapshot(snapshot);
      touch();
    },
    clearRecall() {
      recalled = null;
      touch();
    },
    isRecalled() {
      return recalled !== null;
    },
    reset() {
      accels.length = 0;
      gyros.length = 0;
      mags.length = 0;
      explicitSteps.length = 0;
      headingSamples.length = 0;
      stepLengthM = initialLength;
      drift = cloneDrift(initialDrift);
      accepted = false;
      recalled = null;
      touch();
    },
    getStepLength() {
      return stepLengthM;
    },
    getSnapshot() {
      if (recalled) return cloneSnapshot(recalled);
      if (!accepted && emptySnapshot) return cloneSnapshot(emptySnapshot);
      cached ??= compute();
      return cloneSnapshot(cached);
    },
    startSensors(sensorOptions) {
      if (feed) return Promise.resolve();
      if (starting) return starting;

      const token = generation;
      const pending = startSensorFeed(
        {
          pushAccel(sample) {
            if (token !== generation) return;
            engine.pushAccel(sample);
          },
          pushGyro(sample) {
            if (token !== generation) return;
            engine.pushGyro(sample);
          },
          pushMag(sample) {
            if (token !== generation) return;
            engine.pushMag(sample);
          },
        },
        sensorOptions,
      ).then((next) => {
        if (token !== generation) {
          next.stop();
          return;
        }
        feed = next;
      });

      starting = pending;
      return pending.finally(() => {
        if (starting === pending) starting = null;
      });
    },
    stopSensors() {
      generation += 1;
      const current = feed;
      feed = null;
      starting = null;
      current?.stop();
    },
  };

  return engine;
}

function seedDrift(drift: DriftCorrectionOptions | undefined): DriftState {
  const corridor =
    drift && 'corridor' in drift && drift.corridor !== undefined
      ? copyCorridor(drift.corridor)
      : true;
  const tags = copyTags(drift?.landmarks);
  return {
    corridor,
    closeLoop: drift?.closeLoop === true,
    loopTarget: copyLoopTarget(drift?.loopTarget),
    tags,
    pins: pinsForTags(tags),
  };
}

function cloneDrift(drift: DriftState): DriftState {
  return {
    corridor: copyCorridor(drift.corridor),
    closeLoop: drift.closeLoop,
    loopTarget: drift.loopTarget ? { ...drift.loopTarget } : undefined,
    tags: drift.tags.map(copyTag),
    pins: drift.pins.map(copyPinRecord),
  };
}

function applyDrift(drift: DriftState, options: DriftCorrectionOptions): DriftState {
  const next = cloneDrift(drift);
  if ('corridor' in options) next.corridor = copyCorridor(options.corridor);
  if ('closeLoop' in options) next.closeLoop = options.closeLoop === true;
  if ('loopTarget' in options) next.loopTarget = copyLoopTarget(options.loopTarget);
  if ('landmarks' in options) {
    const labels = new Map(
      next.pins.filter((pin) => pin.anchored).map((pin) => [pin.id, pin.label]),
    );
    next.tags = copyTags(options.landmarks);
    const anchored = pinsForTags(next.tags).map((pin) => ({
      ...pin,
      label: labels.get(pin.id) ?? pin.label,
    }));
    next.pins = [...next.pins.filter((pin) => !pin.anchored), ...anchored];
  }
  return next;
}

function driftOptions(drift: DriftState): DriftCorrectionOptions {
  const options: DriftCorrectionOptions = {};
  if (drift.corridor === true || typeof drift.corridor === 'object') {
    options.corridor = copyCorridor(drift.corridor);
  }
  if (drift.tags.length > 0) options.landmarks = drift.tags.map(copyTag);
  if (drift.closeLoop) options.closeLoop = true;
  if (drift.loopTarget) options.loopTarget = { ...drift.loopTarget };
  return options;
}

function resolvePins(drift: DriftState, corrected: readonly PathPoint[]): Pin[] {
  return drift.pins.map((pin) => {
    if (!pin.anchored) return { id: pin.id, x: pin.x, y: pin.y, label: pin.label };
    const index = anchorIndex(drift.tags, pin.id, corrected.length);
    const point = index === null ? undefined : corrected[index];
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      return { id: pin.id, x: pin.x, y: pin.y, label: pin.label };
    }
    return { id: pin.id, x: point.x, y: point.y, label: pin.label };
  });
}

function anchorIndex(tags: readonly LandmarkTag[], id: string, pathLength: number): number | null {
  let best: number | null = null;
  for (const tag of tags) {
    if (tag.id !== id || !Number.isInteger(tag.pathIndex)) continue;
    if (tag.pathIndex < 0 || tag.pathIndex >= pathLength) continue;
    if (best === null || tag.pathIndex < best) best = tag.pathIndex;
  }
  return best;
}

function pinsForTags(tags: readonly LandmarkTag[]): PinRecord[] {
  const pins: PinRecord[] = [];
  for (const tag of tags) {
    if (pins.some((pin) => pin.id === tag.id)) continue;
    pins.push({ id: tag.id, x: 0, y: 0, label: tag.id, anchored: true });
  }
  return pins;
}

function snapshotHeading(
  course: Course,
  steps: readonly PathStep[],
  headingFusion: Partial<HeadingFusionConfig> | undefined,
): number {
  if (course.kind === 'series') return latestSampleHeading(course.samples);
  const fromStep = latestStepHeading(steps);
  if (fromStep !== null) return fromStep;
  return resolvedInitialHeading(headingFusion);
}

function latestSampleHeading(samples: readonly HeadingSample[]): number {
  let bestT = Number.NEGATIVE_INFINITY;
  let best = 0;
  let found = false;
  for (const sample of samples) {
    if (!Number.isFinite(sample.t) || !Number.isFinite(sample.heading)) continue;
    if (!found || sample.t >= bestT) {
      found = true;
      bestT = sample.t;
      best = sample.heading;
    }
  }
  return wrap360(best);
}

function latestStepHeading(steps: readonly PathStep[]): number | null {
  let bestT = Number.NEGATIVE_INFINITY;
  let best: number | null = null;
  for (const step of steps) {
    if (!Number.isFinite(step.t) || step.heading === undefined || !Number.isFinite(step.heading)) {
      continue;
    }
    if (best === null || step.t >= bestT) {
      bestT = step.t;
      best = step.heading;
    }
  }
  return best === null ? null : wrap360(best);
}

function resolvedInitialHeading(config: Partial<HeadingFusionConfig> | undefined): number {
  const value = config?.initialHeadingDeg;
  if (value === undefined || !Number.isFinite(value)) return 0;
  return wrap360(value);
}

function accelAccepted(sample: StepSample): boolean {
  if (!Number.isFinite(sample.t)) return false;
  if ('x' in sample) {
    return Number.isFinite(sample.x) && Number.isFinite(sample.y) && Number.isFinite(sample.z);
  }
  return Number.isFinite(sample.magnitude);
}

function copyAccel(sample: StepSample): StepSample {
  if ('x' in sample) return { t: sample.t, x: sample.x, y: sample.y, z: sample.z };
  return { t: sample.t, magnitude: sample.magnitude };
}

function copyPathStep(step: PathStep): PathStep {
  if (step.heading === undefined) return { t: step.t };
  return { t: step.t, heading: step.heading };
}

function copyHeading(sample: HeadingSample): HeadingSample {
  return { t: sample.t, heading: sample.heading };
}

function copyTag(tag: LandmarkTag): LandmarkTag {
  return { id: tag.id, pathIndex: tag.pathIndex };
}

function copyTags(tags: readonly LandmarkTag[] | undefined): LandmarkTag[] {
  if (!tags) return [];
  return tags.map(copyTag);
}

function copyPinRecord(pin: PinRecord): PinRecord {
  return { id: pin.id, x: pin.x, y: pin.y, label: pin.label, anchored: pin.anchored };
}

function copyCorridor(
  corridor: DriftCorrectionOptions['corridor'],
): DriftCorrectionOptions['corridor'] {
  if (typeof corridor === 'boolean') return corridor;
  if (corridor && typeof corridor === 'object') return { ...corridor };
  return false;
}

function copyLoopTarget(
  target: { x: number; y: number } | undefined,
): { x: number; y: number } | undefined {
  if (!target || !Number.isFinite(target.x) || !Number.isFinite(target.y)) return undefined;
  return { x: target.x, y: target.y };
}

function cloneSnapshot(snapshot: EngineSnapshot): EngineSnapshot {
  return {
    rawPath: snapshot.rawPath.map(copyPoint),
    correctedPath: snapshot.correctedPath.map(copyPoint),
    stepCount: snapshot.stepCount,
    heading: snapshot.heading,
    pins: snapshot.pins.map((pin) => ({ id: pin.id, x: pin.x, y: pin.y, label: pin.label })),
  };
}

function copyPoint(point: PathPoint): PathPoint {
  return { x: point.x, y: point.y, t: point.t };
}

function wrap360(deg: number): number {
  if (!Number.isFinite(deg)) return 0;
  const wrapped = ((deg % 360) + 360) % 360;
  return wrapped === 0 ? 0 : wrapped;
}

function finiteOr(value: number | undefined, fallback: number): number {
  return value === undefined || !Number.isFinite(value) ? fallback : value;
}
