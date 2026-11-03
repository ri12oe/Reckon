import {
  createMemoryFloorStore,
  createSqliteFloorStore,
  floorExportDocument,
  type FloorStore,
  type SqlExecutor,
} from '@/db/floors';
import { applyFloorSchema } from '@/db/schema';
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
    pitchPaused: false,
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
      const empty = {
        rawPath: [{ x: 0, y: 0, t: 0 }],
        correctedPath: [{ x: 0, y: 0, t: 0 }],
        stepCount: 0,
        heading: 0,
        pins: [],
        pitchPaused: false,
      };
      expect(saved.snapshot).toEqual(empty);
      expect(store.get(saved.id)?.snapshot).toEqual(empty);
    });

    test('reloads gyroOnly true, false, and omitted', async () => {
      const store = await open();
      const gyro = store.save({
        buildingName: 'North Hall',
        floorName: 'Gyro',
        snapshot: { ...sample(), gyroOnly: true },
      });
      const trusted = store.save({
        buildingName: 'North Hall',
        floorName: 'Trusted',
        snapshot: { ...sample(), gyroOnly: false },
      });
      const plain = store.save({
        buildingName: 'North Hall',
        floorName: 'Plain',
        snapshot: sample(),
      });

      expect(store.get(gyro.id)?.snapshot.gyroOnly).toBe(true);
      expect(store.get(trusted.id)?.snapshot.gyroOnly).toBe(false);
      expect(store.get(plain.id)?.snapshot.gyroOnly).toBeUndefined();
      expect(store.get(plain.id)?.snapshot).toEqual(sample());

      const gyroFloor = store.get(gyro.id);
      const trustedFloor = store.get(trusted.id);
      const plainFloor = store.get(plain.id);
      if (!gyroFloor || !trustedFloor || !plainFloor) throw new Error('saved floor missing');
      expect(floorExportDocument(gyroFloor).snapshot.gyroOnly).toBe(true);
      expect(floorExportDocument(trustedFloor).snapshot.gyroOnly).toBe(false);
      expect(floorExportDocument(plainFloor).snapshot.gyroOnly).toBeUndefined();
      expect(floorExportDocument(plainFloor).snapshot).toEqual(sample());
    });

    test('reloads gyroOnly false and leaves a sensor fault off the snapshot', async () => {
      const store = await open();
      const saved = store.save({
        buildingName: 'North Hall',
        floorName: 'Level 1',
        snapshot: { ...sample(), gyroOnly: false, sensorStartFailed: 'permission' },
      });
      const loaded = store.get(saved.id)?.snapshot;
      expect(loaded?.gyroOnly).toBe(false);
      expect(loaded?.sensorStartFailed).toBeUndefined();
      expect(loaded?.isCannedDemo).toBeUndefined();
    });
  });
}

function openSqlite(): FloorStore {
  const { DatabaseSync } = loadSqlite();
  const db = wrap(new DatabaseSync(':memory:'));
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

const LEGACY_FLOOR_DDL = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS buildings (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS floors (
  id TEXT PRIMARY KEY NOT NULL,
  building_id TEXT NOT NULL,
  name TEXT NOT NULL,
  step_count INTEGER NOT NULL,
  heading REAL NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (building_id) REFERENCES buildings (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS path_points (
  floor_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('raw', 'corrected')),
  seq INTEGER NOT NULL,
  x REAL NOT NULL,
  y REAL NOT NULL,
  t REAL NOT NULL,
  PRIMARY KEY (floor_id, kind, seq),
  FOREIGN KEY (floor_id) REFERENCES floors (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS pins (
  floor_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  id TEXT NOT NULL,
  x REAL NOT NULL,
  y REAL NOT NULL,
  label TEXT NOT NULL,
  PRIMARY KEY (floor_id, seq),
  FOREIGN KEY (floor_id) REFERENCES floors (id) ON DELETE CASCADE
);
`;

describe('floor stores', () => {
  behavesLikeFloorStore('memory', () => createMemoryFloorStore({ now: clock() }));
  behavesLikeFloorStore('sqlite', openSqlite);

  test('sqlite opens a floor saved before gyro_only existed', () => {
    const { DatabaseSync } = loadSqlite();
    const db = wrap(new DatabaseSync(':memory:'));
    db.execSync(LEGACY_FLOOR_DDL);
    db.runSync(
      'INSERT INTO buildings (id, name, created_at) VALUES (?, ?, ?)',
      'bldg_old',
      'North Hall',
      1_000,
    );
    db.runSync(
      `INSERT INTO floors (id, building_id, name, step_count, heading, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      'floor_old',
      'bldg_old',
      'Level 1',
      3,
      90,
      1_000,
    );
    db.runSync(
      'INSERT INTO path_points (floor_id, kind, seq, x, y, t) VALUES (?, ?, ?, ?, ?, ?)',
      'floor_old',
      'corrected',
      0,
      4,
      5,
      6,
    );

    applyFloorSchema(db);
    applyFloorSchema(db);
    const store = createSqliteFloorStore(db, { now: clock() });
    const loaded = store.get('floor_old');
    expect(loaded?.snapshot.correctedPath).toEqual([{ x: 4, y: 5, t: 6 }]);
    expect(loaded?.snapshot.gyroOnly).toBeUndefined();

    const saved = store.save({
      buildingName: 'North Hall',
      floorName: 'Gyro',
      snapshot: { ...sample(), gyroOnly: true },
    });
    expect(store.get(saved.id)?.snapshot.gyroOnly).toBe(true);
  });

  test('sqlite applyFloorSchema twice on a new file round-trips gyroOnly true', () => {
    const { DatabaseSync } = loadSqlite();
    const db = wrap(new DatabaseSync(':memory:'));
    applyFloorSchema(db);
    applyFloorSchema(db);
    const store = createSqliteFloorStore(db, { now: clock() });
    const saved = store.save({
      buildingName: 'North Hall',
      floorName: 'Gyro',
      snapshot: { ...sample(), gyroOnly: true },
    });
    expect(store.get(saved.id)?.snapshot.gyroOnly).toBe(true);
  });

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
