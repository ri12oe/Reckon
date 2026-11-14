import type { EngineSnapshot, SensorStartFault, SensorStartResult } from '@/engine';

const FAULT_COPY: Record<SensorStartFault, string> = {
  permission: 'motion permission needed',
  unavailable: 'motion sensors unavailable',
  error: 'could not start sensors',
};

export type WalkPill = {
  label: string;
  live: boolean;
};

export function sensorStartFaultMessage(result: SensorStartResult): string | null {
  if (result.ok || result.reason === 'cancelled') return null;
  return FAULT_COPY[result.reason];
}

type WalkPillSnapshot = Pick<
  EngineSnapshot,
  'heading' | 'pitchPaused' | 'sensorStartFailed' | 'isCannedDemo'
>;

export function walkPill(savedFloor: boolean, snapshot: WalkPillSnapshot): WalkPill {
  if (savedFloor) return { label: 'Saved floor', live: false };
  if (snapshot.sensorStartFailed) {
    return { label: FAULT_COPY[snapshot.sensorStartFailed], live: false };
  }
  if (snapshot.pitchPaused) return { label: 'Paused, hold it level', live: false };
  if (snapshot.isCannedDemo) return { label: 'Demo walk', live: false };
  if (!Number.isFinite(snapshot.heading)) return { label: 'No heading yet', live: false };
  return { label: 'Live', live: true };
}
