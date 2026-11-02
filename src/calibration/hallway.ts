import { commitStepLength } from '@/calibration/commit';
import { noteSteps, type CalibrationSession } from '@/calibration/session';
import type { StepLengthEstimate } from '@/engine/step-length';

type StepLengthTarget = {
  setStepLength(stepLengthM: number): void;
};

export type HallwayEnd = {
  session: CalibrationSession;
  status: string;
  saved: StepLengthEstimate | null;
};

/**
 * Current screen poll: record steps, and save only if that record is already done.
 * The walker has no way to mark the end.
 */
export function createHallwayCalibration(deps: {
  courseMeters: number | null;
  measure: (courseMeters: number, steps: number) => StepLengthEstimate | null;
  live: StepLengthTarget;
}) {
  return {
    poll(session: CalibrationSession, progress: number): CalibrationSession {
      const progressed = noteSteps(session, progress);
      if (progressed.phase !== 'done') return progressed;
      const estimate =
        deps.courseMeters === null ? null : deps.measure(deps.courseMeters, progressed.steps);
      commitStepLength(estimate, deps.live);
      return progressed;
    },
    end(session: CalibrationSession, _progress: number): HallwayEnd {
      return { session, status: '', saved: null };
    },
  };
}
