import { floorExportDocument } from '@/db/floors';
import { liveWalkFloor } from '@/db/share-floor';

describe('liveWalkFloor', () => {
  const snapshot = {
    rawPath: [{ x: 0, y: 0, t: 0 }],
    correctedPath: [
      { x: 0, y: 0, t: 0 },
      { x: 3, y: 4, t: 900 },
    ],
    stepCount: 6,
    heading: 37,
    pins: [{ id: 'pin-1', x: 3, y: 4, label: 'Pin 1' }],
  };

  test('exports the walk in progress like a saved floor', () => {
    const now = Date.UTC(2026, 9, 31, 13, 30);
    const floor = liveWalkFloor(snapshot, now);
    expect(floor.buildingName).toBe('Live walk');
    expect(floor.name).toBe('2026-10-31 13:30');
    expect(floor.pinCount).toBe(1);
    expect(floor.pointCount).toBe(2);
    expect(floorExportDocument(floor)).toEqual({
      building: 'Live walk',
      floor: '2026-10-31 13:30',
      createdAt: now,
      snapshot,
    });
  });
});
