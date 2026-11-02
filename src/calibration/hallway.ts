import { commitStepLength } from '@/calibration/commit';
import {
  CALIBRATION_STEPS,
  endCalibration,
  noteSteps,
  type CalibrationSession,
} from '@/calibration/session';
import type { StepLengthEstimate } from '@/engine/step-length';

type StepLengthTarget = {
  setStepLength(stepLengthM: number): void;
};

export type HallwayEnd = {
  session: CalibrationSession;
  status: string;
  saved: StepLengthEstimate | null;
};

export function createHallwayCalibration(deps: {
  courseMeters: number | null;
  measure: (courseMeters: number, steps: number) => StepLengthEstimate | null;
  live: StepLengthTarget;
}) {
  return {
    poll(session: CalibrationSession, progress: number): CalibrationSession {
      return noteSteps(session, progress);
    },
    end(session: CalibrationSession, progress: number): HallwayEnd {
      const noted = noteSteps(session, progress);
      const ended = endCalibration(noted);
      if (ended.phase !== 'done') {
        return {
          session: ended,
          status: `Walk at least ${CALIBRATION_STEPS} steps, then mark the end.`,
          saved: null,
        };
      }
      const estimate =
        deps.courseMeters === null ? null : deps.measure(deps.courseMeters, ended.steps);
      const saved = commitStepLength(estimate, deps.live);
      if (!saved) {
        return {
          session: { phase: 'idle', steps: 0 },
          status: 'That distance did not update step length.',
          saved: null,
        };
      }
      return { session: ended, status: '', saved };
    },
  };
}
