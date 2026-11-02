import type { StoredFloor } from '@/db/floors';
import { getActiveFloor, resumeLiveWalk, showSavedFloor } from '@/db/session';
import { emptyRecording, getEngine, mockEngine } from '@/engine';
import { startNewFloor } from '@/library/new-floor';

function recalledFloor(): StoredFloor {
  return {
    id: 'floor-north-2',
    buildingId: 'north',
    buildingName: 'North Hall',
    name: 'Level 2',
    stepCount: 8,
    heading: 0,
    pinCount: 0,
    pointCount: 2,
    createdAt: 1,
    snapshot: {
      rawPath: [
        { x: 0, y: 0, t: 0 },
        { x: 4, y: 0, t: 10 },
      ],
      correctedPath: [
        { x: 0, y: 0, t: 0 },
        { x: 4, y: 0, t: 10 },
      ],
      stepCount: 8,
      heading: 0,
      pins: [],
    },
  };
}

describe('startNewFloor', () => {
  beforeEach(() => {
    getEngine().reset();
    resumeLiveWalk();
  });

  afterEach(() => {
    getEngine().reset();
    resumeLiveWalk();
  });

  test('a walked floor returns to the demo and the save card is empty', () => {
    const engine = getEngine();
    engine.pushStep({ t: 500, heading: 0 });
    expect(engine.getSnapshot().stepCount).toBe(1);
    expect(engine.isRecalled()).toBe(false);

    const card = startNewFloor();

    expect(getActiveFloor()).toBeNull();
    expect(engine.isRecalled()).toBe(false);
    expect(engine.getSnapshot()).toEqual(mockEngine.getSnapshot());
    expect(card).toEqual(emptyRecording());
  });

  test('a recalled floor is no longer showing and the walk underneath is cleared', () => {
    const engine = getEngine();
    engine.pushStep({ t: 500, heading: 90 });
    const floor = recalledFloor();
    showSavedFloor(floor);
    expect(getActiveFloor()).toEqual({
      id: floor.id,
      buildingName: floor.buildingName,
      name: floor.name,
    });
    expect(engine.isRecalled()).toBe(true);
    expect(engine.getSnapshot().stepCount).toBe(8);

    const card = startNewFloor();

    expect(getActiveFloor()).toBeNull();
    expect(engine.isRecalled()).toBe(false);
    expect(engine.getSnapshot()).toEqual(mockEngine.getSnapshot());
    expect(card).toEqual(emptyRecording());
  });

  test('a second press stays on the empty card with no floor showing', () => {
    const engine = getEngine();
    engine.pushStep({ t: 500, heading: 0 });
    showSavedFloor(recalledFloor());

    startNewFloor();
    const card = startNewFloor();

    expect(getActiveFloor()).toBeNull();
    expect(engine.isRecalled()).toBe(false);
    expect(engine.getSnapshot()).toEqual(mockEngine.getSnapshot());
    expect(card).toEqual(emptyRecording());
  });
});
