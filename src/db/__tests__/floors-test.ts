import {
  createMemoryFloorStore,
  createSqliteFloorStore,
  floorExportDocument,
  type FloorStore,
  type SqlExecutor,
} from '@/db/floors';
import { FLOOR_SCHEMA } from '@/db/schema';
import { mockEngine } from '@/engine/mock-engine';
import type { EngineSnapshot } from '@/engine/types';

type SqliteStatement = {
  run(...params: (string | number | null)[]): unknown;
  all(...params: (string | number | null)[]): unknown[];
  get(...params: (string | number | null)[]): unknown;
};

type SqliteDatabase = {
  exec(source: string): void;
  prepare(source: string): SqliteStatement;
};

function loadSqlite(): { DatabaseSync: new (path: string) => SqliteDatabase } {
  // Node's built-in driver. Avoid importing `node:` so tsc does not need @types/node.
  const getBuiltin = (process as unknown as { getBuiltinModule?: (id: string) => unknown })
    .getBuiltinModule;
  if (!getBuiltin) throw new Error('node:sqlite is unavailable');
  return getBuiltin('node:sqlite') as { DatabaseSync: new (path: string) => SqliteDatabase };
}

function sample(): EngineSnapshot {
  return {
    rawPath: [
      { x: 0, y: 0, t: 0 },
      { x: 1.2, y: 0.4, t: 1000 },
    ],
    correctedPath: [
      { x: 0, y: 0, t: 0 },
      { x: 1, y: 0, t: 1000 },
    ],
    stepCount: 3,
    heading: 90,
    pins: [{ id: 'door', x: 1, y: 0, label: 'door' }],
  };
}

function clock() {
  let t = 1_000;
  return () => {
    t += 1;
    return t;
  };
}

function behavesLikeFloorStore(name: string, open: () => FloorStore | Promise<FloorStore>) {
  describe(name, () => {
    test('saves a named floor and reloads the path and pins', async () => {
      const store = await open();
      const snapshot = sample();
      const saved = store.save({
        buildingName: '  North Hall ',
        floorName: 'Level 1',
        snapshot,
      });
      snapshot.pins.push({ id: 'extra', x: 9, y: 9, label: 'extra' });
      snapshot.correctedPath[0]!.x = 99;

      expect(saved.buildingName).toBe('North Hall');
      expect(saved.name).toBe('Level 1');
      expect(saved.stepCount).toBe(3);
      expect(saved.pinCount).toBe(1);
      expect(saved.pointCount).toBe(2);
      expect(store.list().map((floor) => floor.name)).toEqual(['Level 1']);

      const loaded = store.get(saved.id);
      expect(loaded?.snapshot).toEqual(sample());
      expect(loaded?.snapshot).not.toBe(saved.snapshot);
    });

    test('keeps two floors on one building and drops the building with the last floor', async () => {
      const store = await open();
      const first = store.save({
        buildingName: 'North Hall',
        floorName: 'Level 1',
        snapshot: sample(),
      });
      const second = store.save({
        buildingName: 'North Hall',
        floorName: 'Level 2',
        snapshot: sample(),
      });
      const other = store.save({
        buildingName: 'Annex',
        floorName: 'Level 1',
        snapshot: sample(),
      });

      expect(second.buildingId).toBe(first.buildingId);
      expect(other.buildingId).not.toBe(first.buildingId);
      expect(store.list().map((floor) => `${floor.buildingName}/${floor.name}`)).toEqual([
        'Annex/Level 1',
        'North Hall/Level 2',
        'North Hall/Level 1',
      ]);

      store.delete(first.id);
      expect(store.get(second.id)?.buildingId).toBe(first.buildingId);

      store.delete(second.id);
      const again = store.save({
        buildingName: 'North Hall',
        floorName: 'Level 1',
        snapshot: sample(),
      });
      expect(again.buildingId).not.toBe(first.buildingId);
      expect(store.get(other.id)?.buildingName).toBe('Annex');
      expect(store.get('missing')).toBeNull();
    });

    test('rejects a blank or oversized name and writes nothing', async () => {
      const store = await open();
      expect(() =>
        store.save({ buildingName: '   ', floorName: 'Level 1', snapshot: sample() }),
      ).toThrow('Building is required.');
      expect(() =>
        store.save({ buildingName: 'Hall', floorName: ' ', snapshot: sample() }),
      ).toThrow('Floor is required.');
      expect(() =>
        store.save({ buildingName: 'H'.repeat(81), floorName: 'Level 1', snapshot: sample() }),
      ).toThrow('Building is too long.');
      expect(store.list()).toEqual([]);
    });

    test('exports the saved walk as JSON', async () => {
      const store = await open();
      const saved = store.save({
        buildingName: 'North Hall',
        floorName: 'Level 1',
        snapshot: sample(),
      });
      const loaded = store.get(saved.id);
      if (!loaded) throw new Error('saved floor missing');
      const doc = floorExportDocument(loaded);
      expect(doc.building).toBe('North Hall');
      expect(doc.floor).toBe('Level 1');
      expect(doc.createdAt).toBe(saved.createdAt);
      expect(doc.snapshot).toEqual(sample());
      expect(JSON.parse(JSON.stringify(doc))).toEqual(doc);
    });

    test('stores the canned demo as an empty recording', async () => {
      const store = await open();
      const demo = mockEngine.getSnapshot();
      const saved = store.save({
        buildingName: 'North Hall',
        floorName: 'Level 1',
        snapshot: demo,
      });

      expect(demo.stepCount).toBe(12);
      expect(demo.correctedPath).toHaveLength(7);
      expect(demo.pins).toHaveLength(2);
      expect(saved.stepCount).toBe(0);
      expect(saved.pinCount).toBe(0);
      expect(saved.pointCount).toBe(1);
      expect(saved.heading).toBe(0);
      expect(saved.snapshot).toEqual({
        rawPath: [{ x: 0, y: 0, t: 0 }],
        correctedPath: [{ x: 0, y: 0, t: 0 }],
        stepCount: 0,
        heading: 0,
        pins: [],
      });
      expect(store.get(saved.id)?.snapshot.stepCount).toBe(0);
    });
  });
}

function openSqlite(): FloorStore {
  const { DatabaseSync } = loadSqlite();
  const db = wrap(new DatabaseSync(':memory:'));
  db.execSync(FLOOR_SCHEMA);
  return createSqliteFloorStore(db, { now: clock() });
}

function wrap(db: SqliteDatabase): SqlExecutor {
  return {
    execSync(source) {
      db.exec(source);
    },
    runSync(source, ...params) {
      return db.prepare(source).run(...params);
    },
    getAllSync(source, ...params) {
      return db.prepare(source).all(...params) as never;
    },
    getFirstSync(source, ...params) {
      return (db.prepare(source).get(...params) ?? null) as never;
    },
    withTransactionSync(task) {
      db.exec('BEGIN');
      try {
        task();
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
  };
}

describe('floor stores', () => {
  behavesLikeFloorStore('memory', () => createMemoryFloorStore({ now: clock() }));
  behavesLikeFloorStore('sqlite', openSqlite);

  test('sqlite creates the floor tables', () => {
    const { DatabaseSync } = loadSqlite();
    const raw = new DatabaseSync(':memory:');
    createSqliteFloorStore(wrap(raw));
    const names = raw
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all() as { name: string }[];
    expect(names.map((row) => row.name)).toEqual(['buildings', 'floors', 'path_points', 'pins']);
  });
});
