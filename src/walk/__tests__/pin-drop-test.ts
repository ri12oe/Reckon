import { createLiveEngine, mockEngine, type EngineSnapshot } from '@/engine';
import { dropWalkPin, readWalk, type HeldPin } from '@/walk/pin-drop';

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
    expect(engine.getSnapshot().pins.map((item) => item.id)).toEqual(['door', 'desk']);
  });

  test('a pin dropped on a live walk is stored at the live end', () => {
    const demo = mockEngine.getSnapshot();
    const engine = createLiveEngine({ emptySnapshot: demo });
    engine.pushStep({ t: 1000, heading: 0 });
    const live = engine.getSnapshot();
    const end = live.correctedPath.at(-1);
    if (!end) throw new Error('live path is empty');

    const dropped = dropWalkPin(live, demo, false, [], pin);
    for (const item of dropped.commit) engine.addPin(item);

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
    for (const item of settled.commit) engine.addPin(item);

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
