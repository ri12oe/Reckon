import type { ActiveFloor } from '@/db/session';
import type { LiveFloorwalkerEngine } from '@/engine';

export function startWalkSensors(
  engine: Pick<LiveFloorwalkerEngine, 'isRecalled' | 'startSensors'>,
  activeFloor: ActiveFloor | null,
  stillFocused: () => boolean,
  refresh: () => void,
): Promise<void> {
  if (engine.isRecalled() || activeFloor !== null) return Promise.resolve();
  return engine.startSensors().then((started) => {
    if (!stillFocused()) return;
    if (!started.ok && started.reason === 'cancelled') return;
    refresh();
  });
}
