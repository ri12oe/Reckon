import { createMemoryFloorStore } from '@/db/floors';
import { getEngine, mockEngine, type EngineSnapshot } from '@/engine';
import { createLiveEngine } from '@/engine/live-engine';
import { snapshotForSaveCard } from '@/library/save-card';
import { formatDistance, pathLength } from '@/walk/stats';

function cardLine(snapshot: EngineSnapshot): string {
  return `${snapshot.stepCount} steps · ${formatDistance(pathLength(snapshot.correctedPath))}`;
}

describe('snapshotForSaveCard', () => {
  test('a canned demo shows and stores the empty recording, not the 12-step picture', () => {
    const engine = createLiveEngine({ emptySnapshot: mockEngine.getSnapshot() });
    const picture = engine.getSnapshot();
    const card = snapshotForSaveCard(engine);

    expect(picture.isCannedDemo).toBe(true);
    expect(cardLine(picture)).toBe('12 steps · 9.0 m');
    expect(card).toEqual(engine.snapshotForSave());
    expect(cardLine(card)).toBe('0 steps · 0 m');
    expect(card.stepCount).toBe(0);
    expect(card.correctedPath).toHaveLength(1);
    expect(card.rawPath).toHaveLength(1);

    const saved = createMemoryFloorStore().save({
      buildingName: 'North Hall',
      floorName: 'Level 1',
      snapshot: card,
    });
    expect(saved.stepCount).toBe(0);
    expect(saved.pointCount).toBe(1);
    expect(saved.snapshot.correctedPath).toEqual([{ x: 0, y: 0, t: 0 }]);
    expect(engine.getSnapshot().stepCount).toBe(12);
  });

  test('the shared engine serves the same empty card while the picture stays the demo', () => {
    const engine = getEngine();
    const card = snapshotForSaveCard(engine);
    expect(engine.getSnapshot().isCannedDemo).toBe(true);
    expect(cardLine(engine.getSnapshot())).toBe('12 steps · 9.0 m');
    expect(cardLine(card)).toBe('0 steps · 0 m');
    expect(card).toEqual(engine.snapshotForSave());
  });

  test('a recalled demo with an extra pin still saves empty', () => {
    const engine = createLiveEngine({ emptySnapshot: mockEngine.getSnapshot() });
    const picture = engine.getSnapshot();
    engine.recallSnapshot({
      ...picture,
      pins: [...picture.pins, { id: 'extra', x: 1, y: 1, label: 'extra' }],
    });

    const shown = engine.getSnapshot();
    const card = snapshotForSaveCard(engine);
    expect(shown.isCannedDemo).toBe(true);
    expect(shown.stepCount).toBe(12);
    expect(card.stepCount).toBe(0);
    expect(card.correctedPath).toHaveLength(1);
    expect(card).toEqual(engine.snapshotForSave());
  });

  test('a real walk keeps the snapshot the card already shows and saves', () => {
    const engine = createLiveEngine({ emptySnapshot: mockEngine.getSnapshot() });
    engine.pushStep({ t: 500, heading: 90 });
    const live = engine.getSnapshot();
    const card = snapshotForSaveCard(engine);

    expect(live.isCannedDemo).toBeUndefined();
    expect(card).toEqual(live);
    expect(card.stepCount).toBe(1);
    expect(cardLine(card)).not.toBe('0 steps · 0 m');
    expect(engine.getSnapshot()).toEqual(live);
  });

  test('without the demo flag the card keeps getSnapshot, including a sensor fault', () => {
    const shown: EngineSnapshot = {
      rawPath: [
        { x: 0, y: 0, t: 0 },
        { x: 1, y: 0, t: 500 },
      ],
      correctedPath: [
        { x: 0, y: 0, t: 0 },
        { x: 1, y: 0, t: 500 },
      ],
      stepCount: 1,
      heading: 90,
      pins: [],
      sensorStartFailed: 'permission',
    };
    const stripped: EngineSnapshot = { ...shown };
    delete stripped.sensorStartFailed;

    const card = snapshotForSaveCard({
      getSnapshot: () => shown,
      snapshotForSave: () => stripped,
    });
    expect(card).toBe(shown);
    expect(card.sensorStartFailed).toBe('permission');
    expect(card.stepCount).toBe(1);
  });
});
