import { createLiveEngine, mockEngine, type EngineSnapshot, type LandmarkPin } from '@/engine';
import {
  commitWalkPins,
  dropLandmark,
  dropWalkPin,
  emptyLandmark,
  newLandmark,
  readWalk,
  type HeldPin,
  type OpenLandmark,
} from '@/walk/pin-drop';

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

function liveDrop(
  open: OpenLandmark,
  engine: ReturnType<typeof createLiveEngine>,
  held: readonly HeldPin[],
) {
  const demo = mockEngine.getSnapshot();
  return dropLandmark(open, engine.getSnapshot(), demo, false, held);
}

describe('drop landmark', () => {
  test('the first drop mints a landmark and the next drop tags that same id', () => {
    const demo = mockEngine.getSnapshot();
    const engine = createLiveEngine({ emptySnapshot: demo });
    const seen: LandmarkPin[] = [];
    const record = {
      tagLandmark(tag: LandmarkPin) {
        seen.push(tag);
        engine.tagLandmark(tag);
      },
    };

    engine.pushStep({ t: 1000, heading: 0 });
    const first = liveDrop(emptyLandmark(), engine, []);
    expect(first.placed).toBe(true);
    expect(first.read.commit).toEqual([{ id: 'pin-1', label: 'Pin 1' }]);
    commitWalkPins(record, first.read);

    engine.pushStep({ t: 1500, heading: 90 });
    const second = liveDrop(first.open, engine, first.read.held);
    expect(second.read.commit).toEqual([{ id: 'pin-1', label: 'Pin 1' }]);
    expect(second.open).toEqual(first.open);
    commitWalkPins(record, second.read);

    expect(seen).toEqual([
      { id: 'pin-1', label: 'Pin 1' },
      { id: 'pin-1', label: 'Pin 1' },
    ]);
    expect(engine.getSnapshot().pins.filter((item) => item.id === 'pin-1')).toHaveLength(1);
  });

  test('new pin mints the next landmark on the following drop', () => {
    const demo = mockEngine.getSnapshot();
    const engine = createLiveEngine({ emptySnapshot: demo });
    const seen: string[] = [];
    const record = {
      tagLandmark(tag: LandmarkPin) {
        seen.push(tag.id);
        engine.tagLandmark(tag);
      },
    };

    engine.pushStep({ t: 1000, heading: 0 });
    const first = liveDrop(emptyLandmark(), engine, []);
    commitWalkPins(record, first.read);

    engine.pushStep({ t: 1500, heading: 90 });
    const again = liveDrop(newLandmark(newLandmark(first.open)), engine, []);
    expect(again.read.commit).toEqual([{ id: 'pin-2', label: 'Pin 2' }]);
    commitWalkPins(record, again.read);

    engine.pushStep({ t: 2000, heading: 180 });
    const third = liveDrop(again.open, engine, again.read.held);
    expect(third.read.commit).toEqual([{ id: 'pin-2', label: 'Pin 2' }]);
    commitWalkPins(record, third.read);

    expect(seen).toEqual(['pin-1', 'pin-2', 'pin-2']);
  });

  test('a second drop of the same landmark on the demo stays held once', () => {
    const demo = mockEngine.getSnapshot();
    const engine = createLiveEngine({ emptySnapshot: demo });
    const first = dropLandmark(emptyLandmark(), engine.getSnapshot(), demo, false, []);
    expect(first.read.commit).toEqual([]);
    expect(first.read.held).toEqual([{ id: 'pin-1', label: 'Pin 1' }]);

    const second = dropLandmark(first.open, engine.getSnapshot(), demo, false, first.read.held);
    expect(second.placed).toBe(false);
    expect(second.read.commit).toEqual([]);
    expect(second.read.held).toEqual([{ id: 'pin-1', label: 'Pin 1' }]);
    expect(second.open).toEqual(first.open);
    expect(second.read.shown.pins.filter((item) => item.id === 'pin-1')).toHaveLength(1);
  });

  test('a recalled floor does not mint a landmark or commit a pin', () => {
    const demo = mockEngine.getSnapshot();
    const dropped = dropLandmark(emptyLandmark(), demo, demo, true, []);
    expect(dropped.placed).toBe(false);
    expect(dropped.read.commit).toEqual([]);
    expect(dropped.read.held).toEqual([]);
    expect(dropped.open).toEqual(emptyLandmark());

    const engine = createLiveEngine({ emptySnapshot: demo });
    engine.pushStep({ t: 1000, heading: 0 });
    const next = liveDrop(dropped.open, engine, []);
    expect(next.read.commit).toEqual([{ id: 'pin-1', label: 'Pin 1' }]);
  });
});
