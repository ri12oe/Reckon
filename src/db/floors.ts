import { FLOOR_SCHEMA } from '@/db/schema';
import type { EngineSnapshot, PathPoint, Pin } from '@/engine/types';

const MAX_NAME_LENGTH = 80;

export type FloorSummary = {
  id: string;
  buildingId: string;
  buildingName: string;
  name: string;
  stepCount: number;
  heading: number;
  pinCount: number;
  pointCount: number;
  createdAt: number;
};

export type StoredFloor = FloorSummary & {
  snapshot: EngineSnapshot;
};

export type FloorExportDocument = {
  building: string;
  floor: string;
  createdAt: number;
  snapshot: EngineSnapshot;
};

export type SaveFloorInput = {
  buildingName: string;
  floorName: string;
  snapshot: EngineSnapshot;
};

export type FloorStore = {
  readonly persistent: boolean;
  list(): FloorSummary[];
  save(input: SaveFloorInput): StoredFloor;
  get(id: string): StoredFloor | null;
  delete(id: string): void;
};

type StoreOptions = {
  now?: () => number;
  createId?: (prefix: string) => string;
};

type SqlBind = string | number | null;

/** The sync surface `expo-sqlite` and the tests both implement. */
export type SqlExecutor = {
  execSync(source: string): void;
  runSync(source: string, ...params: SqlBind[]): unknown;
  getAllSync<T>(source: string, ...params: SqlBind[]): T[];
  getFirstSync<T>(source: string, ...params: SqlBind[]): T | null;
  withTransactionSync(task: () => void): void;
};

type BuildingRow = { id: string };
type FloorListRow = {
  id: string;
  building_id: string;
  building_name: string;
  name: string;
  step_count: number;
  heading: number;
  created_at: number;
  point_count: number;
  pin_count: number;
};
type FloorRow = {
  id: string;
  building_id: string;
  building_name: string;
  name: string;
  step_count: number;
  heading: number;
  created_at: number;
};
type PointRow = { kind: string; x: number; y: number; t: number };
type PinRow = { id: string; x: number; y: number; label: string };

const LIST_SQL = `
SELECT
  f.id AS id,
  f.building_id AS building_id,
  b.name AS building_name,
  f.name AS name,
  f.step_count AS step_count,
  f.heading AS heading,
  f.created_at AS created_at,
  (
    SELECT COUNT(*) FROM path_points p
    WHERE p.floor_id = f.id AND p.kind = 'corrected'
  ) AS point_count,
  (SELECT COUNT(*) FROM pins pin WHERE pin.floor_id = f.id) AS pin_count
FROM floors f
JOIN buildings b ON b.id = f.building_id
ORDER BY f.created_at DESC, f.id DESC
`;

export function createMemoryFloorStore(options?: StoreOptions): FloorStore {
  const buildings: { id: string; name: string; createdAt: number }[] = [];
  const floors: StoredFloor[] = [];
  const now = options?.now ?? Date.now;
  const createId = options?.createId ?? defaultCreateId;

  return {
    persistent: false,
    list() {
      return floors.map(toSummary).sort(newestFirst);
    },
    save(input) {
      const prepared = prepareSave(input, now);
      const existing = buildings.find((building) => building.name === prepared.buildingName);
      const buildingId = existing?.id ?? createId('bldg');
      if (!existing) {
        buildings.push({
          id: buildingId,
          name: prepared.buildingName,
          createdAt: prepared.createdAt,
        });
      }
      const floor = toStored(createId('floor'), buildingId, prepared);
      floors.push(floor);
      return cloneStored(floor);
    },
    get(id) {
      const floor = floors.find((item) => item.id === id);
      return floor ? cloneStored(floor) : null;
    },
    delete(id) {
      const index = floors.findIndex((item) => item.id === id);
      if (index === -1) return;
      const buildingId = floors[index]?.buildingId;
      floors.splice(index, 1);
      if (!floors.some((item) => item.buildingId === buildingId)) {
        const buildingIndex = buildings.findIndex((building) => building.id === buildingId);
        if (buildingIndex !== -1) buildings.splice(buildingIndex, 1);
      }
    },
  };
}

export function createSqliteFloorStore(db: SqlExecutor, options?: StoreOptions): FloorStore {
  db.execSync(FLOOR_SCHEMA);
  const now = options?.now ?? Date.now;
  const createId = options?.createId ?? defaultCreateId;

  return {
    persistent: true,
    list() {
      return db.getAllSync<FloorListRow>(LIST_SQL).map(summaryFromRow);
    },
    save(input) {
      const prepared = prepareSave(input, now);
      const box: { floor: StoredFloor | null } = { floor: null };
      db.withTransactionSync(() => {
        const existing = db.getFirstSync<BuildingRow>(
          'SELECT id FROM buildings WHERE name = ? LIMIT 1',
          prepared.buildingName,
        );
        const buildingId = existing?.id ?? createId('bldg');
        if (!existing) {
          db.runSync(
            'INSERT INTO buildings (id, name, created_at) VALUES (?, ?, ?)',
            buildingId,
            prepared.buildingName,
            prepared.createdAt,
          );
        }
        const floor = toStored(createId('floor'), buildingId, prepared);
        db.runSync(
          `INSERT INTO floors (id, building_id, name, step_count, heading, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
          floor.id,
          floor.buildingId,
          floor.name,
          floor.stepCount,
          floor.heading,
          floor.createdAt,
        );
        insertPath(db, floor.id, 'raw', floor.snapshot.rawPath);
        insertPath(db, floor.id, 'corrected', floor.snapshot.correctedPath);
        floor.snapshot.pins.forEach((pin, seq) => {
          db.runSync(
            'INSERT INTO pins (floor_id, seq, id, x, y, label) VALUES (?, ?, ?, ?, ?, ?)',
            floor.id,
            seq,
            pin.id,
            pin.x,
            pin.y,
            pin.label,
          );
        });
        box.floor = floor;
      });
      if (!box.floor) throw new Error('Could not save this floor.');
      return cloneStored(box.floor);
    },
    get(id) {
      const row = db.getFirstSync<FloorRow>(
        `SELECT f.id AS id, f.building_id AS building_id, b.name AS building_name,
                f.name AS name, f.step_count AS step_count, f.heading AS heading,
                f.created_at AS created_at
         FROM floors f
         JOIN buildings b ON b.id = f.building_id
         WHERE f.id = ?`,
        id,
      );
      if (!row) return null;
      const points = db.getAllSync<PointRow>(
        'SELECT kind, x, y, t FROM path_points WHERE floor_id = ? ORDER BY kind ASC, seq ASC',
        id,
      );
      const pins = db.getAllSync<PinRow>(
        'SELECT id, x, y, label FROM pins WHERE floor_id = ? ORDER BY seq ASC',
        id,
      );
      const rawPath = points.filter((point) => point.kind === 'raw').map(readPoint);
      const correctedPath = points.filter((point) => point.kind === 'corrected').map(readPoint);
      return {
        ...summaryFromCounts(row, correctedPath.length, pins.length),
        snapshot: {
          rawPath,
          correctedPath,
          stepCount: Number(row.step_count),
          heading: Number(row.heading),
          pins: pins.map(readPin),
        },
      };
    },
    delete(id) {
      db.withTransactionSync(() => {
        const row = db.getFirstSync<{ building_id: string }>(
          'SELECT building_id FROM floors WHERE id = ?',
          id,
        );
        if (!row) return;
        db.runSync('DELETE FROM path_points WHERE floor_id = ?', id);
        db.runSync('DELETE FROM pins WHERE floor_id = ?', id);
        db.runSync('DELETE FROM floors WHERE id = ?', id);
        db.runSync(
          `DELETE FROM buildings
           WHERE id = ? AND NOT EXISTS (SELECT 1 FROM floors WHERE building_id = ?)`,
          row.building_id,
          row.building_id,
        );
      });
    },
  };
}

export function floorExportDocument(floor: StoredFloor): FloorExportDocument {
  return {
    building: floor.buildingName,
    floor: floor.name,
    createdAt: floor.createdAt,
    snapshot: cloneSnapshot(floor.snapshot),
  };
}

export function floorExportJson(floor: StoredFloor): string {
  return JSON.stringify(floorExportDocument(floor), null, 2);
}

function prepareSave(input: SaveFloorInput, now: () => number) {
  return {
    buildingName: cleanName(input.buildingName, 'Building'),
    floorName: cleanName(input.floorName, 'Floor'),
    snapshot: cloneSnapshot(input.snapshot),
    createdAt: now(),
  };
}

function cleanName(value: string, label: string): string {
  const name = value.trim();
  if (!name) throw new Error(`${label} is required.`);
  if (name.length > MAX_NAME_LENGTH) throw new Error(`${label} is too long.`);
  return name;
}

function toStored(
  id: string,
  buildingId: string,
  prepared: ReturnType<typeof prepareSave>,
): StoredFloor {
  const snapshot = prepared.snapshot;
  return {
    id,
    buildingId,
    buildingName: prepared.buildingName,
    name: prepared.floorName,
    stepCount: snapshot.stepCount,
    heading: snapshot.heading,
    pinCount: snapshot.pins.length,
    pointCount: snapshot.correctedPath.length,
    createdAt: prepared.createdAt,
    snapshot,
  };
}

function toSummary(floor: StoredFloor): FloorSummary {
  return {
    id: floor.id,
    buildingId: floor.buildingId,
    buildingName: floor.buildingName,
    name: floor.name,
    stepCount: floor.stepCount,
    heading: floor.heading,
    pinCount: floor.pinCount,
    pointCount: floor.pointCount,
    createdAt: floor.createdAt,
  };
}

function summaryFromRow(row: FloorListRow): FloorSummary {
  return summaryFromCounts(row, Number(row.point_count), Number(row.pin_count));
}

function summaryFromCounts(row: FloorRow, pointCount: number, pinCount: number): FloorSummary {
  return {
    id: row.id,
    buildingId: row.building_id,
    buildingName: row.building_name,
    name: row.name,
    stepCount: Number(row.step_count),
    heading: Number(row.heading),
    pinCount,
    pointCount,
    createdAt: Number(row.created_at),
  };
}

function newestFirst(a: FloorSummary, b: FloorSummary): number {
  if (a.createdAt !== b.createdAt) return b.createdAt - a.createdAt;
  if (a.id === b.id) return 0;
  return a.id < b.id ? 1 : -1;
}

function insertPath(
  db: SqlExecutor,
  floorId: string,
  kind: 'raw' | 'corrected',
  points: readonly PathPoint[],
) {
  points.forEach((point, seq) => {
    db.runSync(
      'INSERT INTO path_points (floor_id, kind, seq, x, y, t) VALUES (?, ?, ?, ?, ?, ?)',
      floorId,
      kind,
      seq,
      point.x,
      point.y,
      point.t,
    );
  });
}

function readPoint(row: PointRow): PathPoint {
  return { x: Number(row.x), y: Number(row.y), t: Number(row.t) };
}

function readPin(row: PinRow): Pin {
  return { id: String(row.id), x: Number(row.x), y: Number(row.y), label: String(row.label) };
}

function cloneStored(floor: StoredFloor): StoredFloor {
  return { ...floor, snapshot: cloneSnapshot(floor.snapshot) };
}

function cloneSnapshot(snapshot: EngineSnapshot): EngineSnapshot {
  return {
    rawPath: snapshot.rawPath.map(copyPoint),
    correctedPath: snapshot.correctedPath.map(copyPoint),
    stepCount: Number.isFinite(snapshot.stepCount) ? snapshot.stepCount : 0,
    heading: Number.isFinite(snapshot.heading) ? snapshot.heading : 0,
    pins: snapshot.pins.map(copyPin),
  };
}

function copyPoint(point: PathPoint): PathPoint {
  return {
    x: finite(point.x),
    y: finite(point.y),
    t: finite(point.t),
  };
}

function copyPin(pin: Pin): Pin {
  return {
    id: pin.id,
    x: finite(pin.x),
    y: finite(pin.y),
    label: pin.label,
  };
}

function finite(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function defaultCreateId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}
