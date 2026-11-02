import { createLiveEngine, mockEngine, type EngineSnapshot } from '@/engine';
import { commitWalkPins, dropWalkPin, readWalk, type HeldPin } from '@/walk/pin-drop';

const pin: HeldPin = { id: 'pin-1', label: 'pin 1' };

function demoEnd(snapshot: EngineSnapshot) {
  const point = snapshot.correctedPath.at(-1);
  if (!point) throw new Error('demo path is empty');
  return { x: point.x, y: point.y };
}

describe('walk pin drop', () => {
  test('a pin dropped on the demo is drawn at the demo end and is not stored yet', () => {
    const demo = mockEngine.getSnapshot();
    const engine = createLiveEngine({ emptySnapshot: demo });

    const dropped = dropWalkPin(engine.getSnapshot(), demo, false, [], pin);

    expect(dropped.commit).toEqual([]);
    expect(dropped.held).toEqual([pin]);
    expect(dropped.shown.pins.at(-1)).toEqual({ ...pin, ...demoEnd(demo) });
    commitWalkPins(engine, dropped);
    expect(engine.getSnapshot().pins.map((item) => item.id)).toEqual(['door', 'desk']);

    engine.pushStep({ t: 1000, heading: 0 });
    expect(engine.getSnapshot().pins.map((item) => item.id)).not.toContain(pin.id);
  });

  test('a start fault on the demo still holds the pin instead of storing it', () => {
    const demo = mockEngine.getSnapshot();
    const shown = { ...demo, sensorStartFailed: 'permission' as const };
    const dropped = dropWalkPin(shown, demo, false, [], pin);

    expect(dropped.commit).toEqual([]);
    expect(dropped.held).toEqual([pin]);
    expect(dropped.shown.sensorStartFailed).toBe('permission');
  });

  test('a pin dropped on a live walk is stored at the live end', () => {
    const demo = mockEngine.getSnapshot();
    const engine = createLiveEngine({ emptySnapshot: demo });
    engine.pushStep({ t: 1000, heading: 0 });
    const live = engine.getSnapshot();
    const end = live.correctedPath.at(-1);
    if (!end) throw new Error('live path is empty');

    const dropped = dropWalkPin(live, demo, false, [], pin);
    expect(dropped.commit).toEqual([{ id: pin.id, label: pin.label }]);
    commitWalkPins(engine, dropped);

    expect(dropped.held).toEqual([]);
    expect(dropped.shown.pins).toContainEqual({
      id: pin.id,
      label: pin.label,
      x: end.x,
      y: end.y,
    });
    expect(engine.getSnapshot().pins).toContainEqual({
      id: pin.id,
      label: pin.label,
      x: end.x,
      y: end.y,
    });
    expect(end).not.toEqual(demoEnd(demo));
  });

  test('a pin held on the demo commits at the live end once a sample exists', () => {
    const demo = mockEngine.getSnapshot();
    const engine = createLiveEngine({ emptySnapshot: demo });
    const dropped = dropWalkPin(engine.getSnapshot(), demo, false, [], pin);
    expect(dropped.commit).toEqual([]);

    engine.pushStep({ t: 1000, heading: 0 });
    const settled = readWalk(engine.getSnapshot(), demo, false, dropped.held);
    expect(settled.commit).toEqual([{ id: pin.id, label: pin.label }]);
    commitWalkPins(engine, settled);

    const live = engine.getSnapshot();
    const end = live.correctedPath.at(-1);
    if (!end) throw new Error('live path is empty');
    expect(settled.held).toEqual([]);
    expect(settled.shown.pins).toContainEqual({
      id: pin.id,
      label: pin.label,
      x: end.x,
      y: end.y,
    });
    expect(live.pins).toContainEqual({ id: pin.id, label: pin.label, x: end.x, y: end.y });
    expect({ x: end.x, y: end.y }).not.toEqual(demoEnd(demo));

    const again = readWalk(live, demo, false, settled.held);
    expect(again.commit).toEqual([]);
    expect(engine.snapshotForSave().pins).toContainEqual({
      id: pin.id,
      label: pin.label,
      x: end.x,
      y: end.y,
    });
  });

  test('a live pin stays on the path when the walk is snapped', () => {
    const demo = mockEngine.getSnapshot();
    const engine = createLiveEngine({ stepLengthM: 1, drift: { corridor: false } });
    for (const [index, heading] of [10, 10, 10, 10].entries()) {
      engine.pushStep({ t: (index + 1) * 500, heading });
    }

    const dropped = dropWalkPin(engine.getSnapshot(), demo, false, [], pin);
    expect(dropped.commit).toEqual([{ id: pin.id, label: pin.label }]);
    commitWalkPins(engine, dropped);

    const before = engine.getSnapshot();
    const end = before.correctedPath.at(-1);
    if (!end) throw new Error('live path is empty');
    expect(before.pins).toContainEqual({ id: pin.id, label: pin.label, x: end.x, y: end.y });

    engine.setDrift({ corridor: true });
    const after = engine.getSnapshot();
    const snapped = after.correctedPath.at(-1);
    if (!snapped) throw new Error('snapped path is empty');
    expect(after.pins).toContainEqual({
      id: pin.id,
      label: pin.label,
      x: snapped.x,
      y: snapped.y,
    });
    expect(snapped).not.toEqual(end);
  });

  test('a recalled floor does not take a pin that is still held for the live walk', () => {
    const demo = mockEngine.getSnapshot();
    const saved: EngineSnapshot = {
      rawPath: [{ x: 0, y: 0, t: 0 }],
      correctedPath: [{ x: 8, y: 1, t: 10 }],
      stepCount: 2,
      heading: 45,
      pins: [],
    };

    const settled = readWalk(saved, demo, true, [pin]);

    expect(settled.commit).toEqual([]);
    expect(settled.held).toEqual([pin]);
    expect(settled.shown.pins).toEqual([]);
  });
});
