import type { SensorStartFault, SensorStartResult } from '@/engine';

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

export function walkPill(savedFloor: boolean, fault: SensorStartFault | undefined): WalkPill {
  if (savedFloor) return { label: 'Saved floor', live: false };
  if (fault) return { label: FAULT_COPY[fault], live: false };
  return { label: 'Live', live: true };
}
