import { saveStepLength } from '@/db/calibration';
import type { StepLengthEstimate } from '@/engine/step-length';

type StepLengthTarget = {
  setStepLength(stepLengthM: number): void;
};

/**
 * Keeps a successful calibration on `live` and in the database.
 * A null estimate changes neither, so the shared engine stays on its current length.
 */
export function commitStepLength(
  estimate: StepLengthEstimate | null,
  live: StepLengthTarget,
): StepLengthEstimate | null {
  const saved = saveStepLength(estimate);
  if (!saved) return null;
  live.setStepLength(saved.stepLengthM);
  return saved;
}
