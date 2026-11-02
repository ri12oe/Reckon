type StrokeCounts = { reset: number; move: number; line: number; build: number };

function strokeCounts(): StrokeCounts {
  const holder = globalThis as { __strokeCounts?: StrokeCounts };
  if (!holder.__strokeCounts) holder.__strokeCounts = { reset: 0, move: 0, line: 0, build: 0 };
  return holder.__strokeCounts;
}

class FakePath {
  readonly d: string;
  readonly dispose = jest.fn();

  constructor(d: string) {
    this.d = d;
  }
}

jest.mock('@shopify/react-native-skia', () => {
  const holder = globalThis as {
    __strokeCounts?: { reset: number; move: number; line: number; build: number };
  };
  const counts = (holder.__strokeCounts ??= { reset: 0, move: 0, line: 0, build: 0 });

  class FakeBuilder {
    cmds: string[] = [];

    reset() {
      counts.reset += 1;
      this.cmds = [];
      return this;
    }

    moveTo(x: number, y: number) {
      counts.move += 1;
      this.cmds.push(`M ${x} ${y}`);
      return this;
    }

    lineTo(x: number, y: number) {
      counts.line += 1;
      this.cmds.push(`L ${x} ${y}`);
      return this;
    }

    build() {
      counts.build += 1;
      return { d: this.cmds.join(' '), dispose: jest.fn() };
    }

    dispose() {}
  }

  return {
    Skia: {
      PathBuilder: {
        Make: () => new FakeBuilder(),
      },
    },
  };
});

const { createStrokeMemory, syncStroke } =
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('@/map/live-stroke') as typeof import('@/map/live-stroke');

const place = (point: { x: number; y: number }) => point;

describe('syncStroke', () => {
  beforeEach(() => {
    const counts = strokeCounts();
    counts.reset = 0;
    counts.move = 0;
    counts.line = 0;
    counts.build = 0;
  });

  test('an unchanged poll returns the same Skia path and does not rebuild it', () => {
    const memory = createStrokeMemory();
    const points = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 2 },
    ];
    const first = syncStroke(memory, points, 'fit', place) as unknown as FakePath;
    const built = strokeCounts().build;
    const again = syncStroke(
      memory,
      points.map((point) => ({ ...point })),
      'fit',
      place,
    );
    expect(again).toBe(first);
    expect(strokeCounts().build).toBe(built);
    expect(strokeCounts().reset).toBe(1);
    expect(strokeCounts().move).toBe(1);
    expect(strokeCounts().line).toBe(2);
    expect(first.d).toBe('M 0 0 L 1 0 L 1 2');
  });

  test('a new tip appends one line and keeps the previous path until the next update', () => {
    const memory = createStrokeMemory();
    const points = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
    ];
    const first = syncStroke(memory, points, 'fit', place) as unknown as FakePath;
    const second = syncStroke(
      memory,
      [...points, { x: 2, y: 0 }],
      'fit',
      place,
    ) as unknown as FakePath;
    expect(second).not.toBe(first);
    expect(second.d).toBe('M 0 0 L 1 0 L 2 0');
    expect(strokeCounts().reset).toBe(1);
    expect(strokeCounts().move).toBe(1);
    expect(strokeCounts().line).toBe(2);
    expect(first.dispose).not.toHaveBeenCalled();

    syncStroke(memory, [...points, { x: 2, y: 4 }, { x: 3, y: 4 }], 'fit', place);
    expect(strokeCounts().reset).toBe(2);
    expect(first.dispose).toHaveBeenCalledTimes(1);
  });
});
