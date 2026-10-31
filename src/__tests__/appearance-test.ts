const mockSaved: { value: string } = { value: 'system' };
const mockSetColorScheme = jest.fn();

jest.mock('@/db/appearance', () => ({
  readAppearance: () => mockSaved.value,
  writeAppearance: (value: string) => {
    mockSaved.value = value;
  },
}));

jest.mock('react-native', () => ({
  Platform: { OS: 'ios' },
  Appearance: { setColorScheme: (value: string) => mockSetColorScheme(value) },
}));

type Store = typeof import('@/appearance');

function loadStore(): Store {
  let store: Store | undefined;
  jest.isolateModules(() => {
    // isolateModules only accepts a synchronous factory.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    store = require('@/appearance') as Store;
  });
  if (!store) throw new Error('appearance did not load');
  return store;
}

beforeEach(() => {
  mockSaved.value = 'system';
  mockSetColorScheme.mockClear();
});

describe('resolveScheme', () => {
  test('system follows the phone and defaults to light', () => {
    const { resolveScheme } = loadStore();
    expect(resolveScheme('system', 'dark')).toBe('dark');
    expect(resolveScheme('system', 'light')).toBe('light');
    expect(resolveScheme('system', null)).toBe('light');
  });

  test('light and dark override the phone', () => {
    const { resolveScheme } = loadStore();
    expect(resolveScheme('light', 'dark')).toBe('light');
    expect(resolveScheme('dark', 'light')).toBe('dark');
  });
});

describe('appearance store', () => {
  test('a choice is saved, applied to native views, and announced', () => {
    const { getAppearance, setAppearance, subscribeAppearance } = loadStore();
    const listener = jest.fn();
    subscribeAppearance(listener);
    expect(getAppearance()).toBe('system');

    setAppearance('dark');
    expect(getAppearance()).toBe('dark');
    expect(mockSaved.value).toBe('dark');
    expect(mockSetColorScheme).toHaveBeenLastCalledWith('dark');
    expect(listener).toHaveBeenCalledTimes(1);

    setAppearance('system');
    expect(mockSetColorScheme).toHaveBeenLastCalledWith('unspecified');
    expect(listener).toHaveBeenCalledTimes(2);
  });

  test('choosing the current value does nothing', () => {
    const { setAppearance, subscribeAppearance } = loadStore();
    const listener = jest.fn();
    subscribeAppearance(listener);
    setAppearance('system');
    expect(listener).not.toHaveBeenCalled();
    expect(mockSetColorScheme).not.toHaveBeenCalled();
  });

  test('a saved override is applied the first time it is read', () => {
    mockSaved.value = 'light';
    const { getAppearance } = loadStore();
    expect(getAppearance()).toBe('light');
    expect(mockSetColorScheme).toHaveBeenCalledWith('light');
  });

  test('reload picks up a choice saved before the database opened', () => {
    const { getAppearance, reloadAppearance, subscribeAppearance } = loadStore();
    expect(getAppearance()).toBe('system');
    const listener = jest.fn();
    subscribeAppearance(listener);
    mockSaved.value = 'dark';
    reloadAppearance();
    expect(getAppearance()).toBe('dark');
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
