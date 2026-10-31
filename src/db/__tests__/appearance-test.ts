const state: { db: FakeDb | null } = { db: null };

jest.mock('@/db/database', () => ({
  getDatabase: () => state.db,
}));

type FakeDb = {
  execSync(source: string): void;
  runSync(source: string, ...params: unknown[]): unknown;
  getFirstSync<T>(source: string, ...params: unknown[]): T | null;
};

type AppearanceStore = typeof import('@/db/appearance');

function loadStore(): AppearanceStore {
  let store: AppearanceStore | undefined;
  jest.isolateModules(() => {
    // isolateModules only accepts a synchronous factory.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    store = require('@/db/appearance') as AppearanceStore;
  });
  if (!store) throw new Error('appearance store did not load');
  return store;
}

function memoryDb(initial: string | null = null): FakeDb {
  let ready = false;
  let preference = initial;
  return {
    execSync(source) {
      if (!source.includes('CREATE TABLE') || !source.includes('appearance')) {
        throw new Error(`unexpected exec: ${source}`);
      }
      ready = true;
    },
    runSync(source, ...params) {
      if (!ready) throw new Error('no table');
      if (!source.includes('INSERT') || !source.includes('appearance')) {
        throw new Error(`unexpected run: ${source}`);
      }
      preference = String(params[0]);
      return { changes: 1, lastInsertRowId: 1 };
    },
    getFirstSync<T>(): T | null {
      if (!ready) throw new Error('no table');
      if (preference === null) return null;
      return { preference } as T;
    },
  };
}

describe('appearance preference', () => {
  test('a fresh database follows the system, and a choice is saved', () => {
    state.db = memoryDb();
    const { readAppearance, writeAppearance } = loadStore();
    expect(readAppearance()).toBe('system');
    writeAppearance('dark');
    expect(readAppearance()).toBe('dark');
    writeAppearance('light');
    expect(readAppearance()).toBe('light');
  });

  test('an unknown saved value falls back to system', () => {
    state.db = memoryDb('sepia');
    const { readAppearance } = loadStore();
    expect(readAppearance()).toBe('system');
  });

  test('a database that cannot be read keeps the choice in memory', () => {
    state.db = {
      execSync() {
        throw new Error('disk');
      },
      runSync() {
        throw new Error('disk');
      },
      getFirstSync() {
        throw new Error('disk');
      },
    };
    const { readAppearance, writeAppearance } = loadStore();
    expect(readAppearance()).toBe('system');
    expect(() => writeAppearance('dark')).not.toThrow();
    expect(readAppearance()).toBe('dark');
  });

  test('without a database the choice is remembered in this session', () => {
    state.db = null;
    const { readAppearance, writeAppearance } = loadStore();
    writeAppearance('light');
    expect(readAppearance()).toBe('light');
  });
});
