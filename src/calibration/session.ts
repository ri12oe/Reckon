/** Steps in the one-time straight-line calibration walk. */
export const CALIBRATION_STEPS = 10;

export type CalibrationPhase = 'idle' | 'walking' | 'done';

export type CalibrationSession = {
  phase: CalibrationPhase;
  steps: number;
};

/**
 * Steps taken since Start.
 *
 * `baseline` is the snapshot `stepCount` at Start. Until the first live
 * sample the shared engine still reports the static demo (12 steps). That
 * demo is not this walk: a later count below the baseline is the live
 * count. Once the snapshot is already live, the walk is the increase.
 */
export function stepsTowardCalibration(baseline: number, stepCount: number): number {
  if (!Number.isFinite(stepCount) || stepCount <= 0) return 0;
  if (!Number.isFinite(baseline) || stepCount < baseline) return stepCount;
  return stepCount - baseline;
}

export function beginCalibration(session: CalibrationSession): CalibrationSession {
  if (session.phase !== 'idle') return session;
  return { phase: 'walking', steps: 0 };
}

export function cancelCalibration(session: CalibrationSession): CalibrationSession {
  if (session.phase !== 'walking') return session;
  return { phase: 'idle', steps: 0 };
}

/** Leaving the screen cancels an in-progress walk and leaves a finished one. */
export function leaveCalibration(session: CalibrationSession): CalibrationSession {
  return cancelCalibration(session);
}

export function noteSteps(session: CalibrationSession, progress: number): CalibrationSession {
  if (session.phase !== 'walking') return session;
  if (!Number.isFinite(progress) || progress < CALIBRATION_STEPS) {
    const steps = Number.isFinite(progress) ? Math.max(0, Math.floor(progress)) : 0;
    if (steps === session.steps) return session;
    return { phase: 'walking', steps };
  }
  return { phase: 'done', steps: CALIBRATION_STEPS };
}
