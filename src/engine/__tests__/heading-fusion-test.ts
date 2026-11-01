import { getEngine, mockEngine } from '@/engine';
import {
  DEFAULT_HEADING_FUSION_CONFIG,
  fuseHeading,
  magneticFieldMagnitude,
  magneticHeadingDeg,
  type FusedHeading,
  type GyroSample,
  type HeadingFusionConfig,
  type MagSample,
} from '@/engine/heading-fusion';

const DT_MS = 20;
const RAD = Math.PI / 180;

/** Open the angle gates so only the magnitude check can reject a reading. */
const OPEN_ANGLE_GATES: Partial<HeadingFusionConfig> = {
  jumpThresholdDeg: 180,
  reacquireMaxDeg: 180,
};

function clock(start: number, end: number, dt = DT_MS): number[] {
  const times: number[] = [];
  for (let t = start; t <= end; t += dt) times.push(t);
  return times;
}

function yaw(degPerSec: number): number {
  return degPerSec * RAD;
}

function gyroAt(
  times: readonly number[],
  degPerSec: number | ((t: number) => number),
): GyroSample[] {
  return times.map((t) => ({
    t,
    yawRate: yaw(typeof degPerSec === 'function' ? degPerSec(t) : degPerSec),
  }));
}

function magAt(
  times: readonly number[],
  field:
    | { x: number; y: number; z: number }
    | ((t: number) => {
        x: number;
        y: number;
        z: number;
      }),
): MagSample[] {
  return times.map((t) => ({ t, ...(typeof field === 'function' ? field(t) : field) }));
}

function north(scale = 1): { x: number; y: number; z: number } {
  return { x: 30 * scale, y: 0, z: 40 * scale };
}

function east(scale = 1): { x: number; y: number; z: number } {
  return { x: 0, y: -30 * scale, z: 40 * scale };
}

function south(scale = 1): { x: number; y: number; z: number } {
  return { x: -30 * scale, y: 0, z: 40 * scale };
}

function west(scale = 1): { x: number; y: number; z: number } {
  return { x: 0, y: 30 * scale, z: 40 * scale };
}

/** Horizontal 30 µT, down 40 µT, so |B| = 50 µT at scale 1. */
function field(headingDeg: number, scale = 1): { x: number; y: number; z: number } {
  const heading = headingDeg * RAD;
  const horizontal = 30 * scale;
  return {
    x: horizontal * Math.cos(heading),
    y: -horizontal * Math.sin(heading),
    z: 40 * scale,
  };
}

function at(samples: readonly FusedHeading[], t: number): FusedHeading {
  const found = samples.find((sample) => sample.t === t);
  if (!found) throw new Error(`no fused sample at ${t} ms`);
  return found;
}

describe('heading fusion defaults', () => {
  test('time constant, Earth-field window, jump gate, and recovery hold', () => {
    expect(DEFAULT_HEADING_FUSION_CONFIG).toEqual({
      tauSeconds: 1.5,
      magnitudeMinUt: 20,
      magnitudeMaxUt: 70,
      magnitudeDeviation: 0.3,
      minHorizontalUt: 5,
      jumpThresholdDeg: 25,
      reacquireMaxDeg: 30,
      recoverHoldMs: 400,
      initialHeadingDeg: 0,
      baselineTauSeconds: 10,
      biasTauSeconds: 5,
    });
  });
});

describe('magnetic heading', () => {
  test('cardinals are 0, 90, 180, and 270; |B| of a 30/40 µT field is 50', () => {
    expect(magneticHeadingDeg(30, 0)).toBe(0);
    expect(magneticHeadingDeg(0, -30)).toBe(90);
    expect(magneticHeadingDeg(-30, 0)).toBe(180);
    expect(magneticHeadingDeg(0, 30)).toBe(270);
    expect(magneticFieldMagnitude(30, 0, 40)).toBe(50);
    expect(magneticFieldMagnitude(0, -30, 40)).toBe(50);
  });
});

describe('fuseHeading', () => {
  test('empty, non-finite, and a single east fix', () => {
    expect(fuseHeading([], [])).toEqual([]);

    const fused = fuseHeading(
      [
        { t: Number.NaN, yawRate: 1 },
        { t: 0, yawRate: Number.POSITIVE_INFINITY },
        { t: 0, yawRate: 0 },
      ],
      [
        { t: 0, x: Number.POSITIVE_INFINITY, y: 0, z: 40 },
        { t: Number.NaN, ...east() },
        { t: 0, ...east() },
      ],
    );

    expect(fused).toHaveLength(1);
    expect(fused[0]).toMatchObject({
      t: 0,
      heading: 90,
      gyroOnly: false,
      interference: false,
      magneticHeading: 90,
      magnitudeUt: 50,
    });
  });

  test('level cardinals: 51 samples at 50 Hz stay on 0, 90, 180, and 270', () => {
    const cases = [
      { heading: 0, field: north() },
      { heading: 90, field: east() },
      { heading: 180, field: south() },
      { heading: 270, field: west() },
    ];

    for (const { heading, field: axes } of cases) {
      const times = clock(0, 1000);
      const fused = fuseHeading(gyroAt(times, 0), magAt(times, axes));
      expect(times).toHaveLength(51);
      expect(fused).toHaveLength(51);
      for (const sample of fused) {
        expect(sample.heading).toBe(heading);
        expect(sample.magneticHeading).toBe(heading);
        expect(sample.magnitudeUt).toBe(50);
        expect(sample.interference).toBe(false);
        expect(sample.gyroOnly).toBe(false);
      }
    }
  });

  test('3 Hz cross-axis noise: compass swings 75.10°–104.90°, fused stays 89.46°–90.53°', () => {
    const times = clock(0, 8000);
    const fused = fuseHeading(
      gyroAt(times, 0),
      magAt(times, (t) => ({
        x: 8 * Math.sin((2 * Math.PI * 3 * t) / 1000),
        y: -30,
        z: 40,
      })),
    );
    const settled = fused.filter((sample) => sample.t >= 6000);
    const magnetic = settled.map((sample) => {
      if (sample.magneticHeading === null) throw new Error(`missing mag at ${sample.t}`);
      return sample.magneticHeading;
    });
    const headings = settled.map((sample) => sample.heading);
    const magMin = Math.min(...magnetic);
    const magMax = Math.max(...magnetic);
    const fusedMin = Math.min(...headings);
    const fusedMax = Math.max(...headings);

    expect(times).toHaveLength(401);
    expect(settled).toHaveLength(101);
    expect(magMin).toBeCloseTo(75.0967, 4);
    expect(magMax).toBeCloseTo(104.9033, 4);
    expect(fusedMin).toBeCloseTo(89.459, 3);
    expect(fusedMax).toBeCloseTo(90.5308, 4);
    expect(Math.max(90 - magMin, magMax - 90)).toBeCloseTo(14.9033, 4);
    expect(Math.max(90 - fusedMin, fusedMax - 90)).toBeLessThan(0.55);
    expect(settled.every((sample) => !sample.interference && !sample.gyroOnly)).toBe(true);
  });

  test('a stable 80° compass reacquires after the hold and blends toward 80°', () => {
    const times = clock(0, 5000);
    const gyro = gyroAt(times, 0);
    const mag = magAt(times, (t) => (t >= 1000 && t <= 3000 ? field(80) : north()));
    const held = fuseHeading(gyro, mag);
    const trusted = fuseHeading(gyro, mag, OPEN_ANGLE_GATES);

    expect(times).toHaveLength(251);
    expect(at(held, 500)).toMatchObject({
      heading: 0,
      magneticHeading: 0,
      interference: false,
      gyroOnly: false,
    });
    expect(at(held, 1380)).toMatchObject({ heading: 0, interference: true, gyroOnly: true });
    expect(at(held, 1400).heading).toBeCloseTo(19.5373, 4);
    expect(at(held, 1400)).toMatchObject({ interference: false, gyroOnly: false });
    expect(at(held, 2000).heading).toBeCloseTo(39.4706, 4);
    expect(at(held, 2000).magneticHeading).toBeCloseTo(80, 6);
    expect(at(held, 2000)).toMatchObject({ interference: false, gyroOnly: false });
    expect(at(held, 3000).heading).toBeCloseTo(59.1915, 4);
    expect(at(held, 3000)).toMatchObject({ interference: false, gyroOnly: false });
    expect(at(held, 3400).heading).toBeCloseTo(59.1915, 4);
    expect(at(held, 3400)).toMatchObject({ interference: true, gyroOnly: true });
    expect(at(held, 3420).heading).toBeCloseTo(44.736, 4);
    expect(at(held, 3420)).toMatchObject({
      magneticHeading: 0,
      interference: false,
      gyroOnly: false,
    });
    expect(at(held, 4000).heading).toBeCloseTo(30.3899, 4);
    expect(at(held, 4000)).toMatchObject({ interference: false, gyroOnly: false });
    expect(at(trusted, 3000).heading).toBeCloseTo(59.1915, 4);
    expect(at(trusted, 3000).interference).toBe(false);
  });

  test('40 µT → 60 µT inside the 20–70 window still drops the compass; open deviation follows it to 59.19°', () => {
    const times = clock(0, 3000);
    const gyro = gyroAt(times, 0);
    const mag = magAt(times, (t) => (t >= 1000 ? field(80, 1.2) : north(0.8)));
    const held = fuseHeading(gyro, mag, OPEN_ANGLE_GATES);
    const followed = fuseHeading(gyro, mag, { ...OPEN_ANGLE_GATES, magnitudeDeviation: 1 });

    expect(at(held, 0).magnitudeUt).toBe(40);
    expect(at(held, 1000).magnitudeUt).toBeCloseTo(60, 6);
    expect(at(held, 1000).magneticHeading).toBeCloseTo(80, 6);
    expect(at(held, 2000)).toMatchObject({ heading: 0, interference: true, gyroOnly: true });
    expect(at(held, 3000)).toMatchObject({ heading: 0, interference: true, gyroOnly: true });
    expect(at(followed, 3000).heading).toBeCloseTo(59.1915, 4);
    expect(at(followed, 3000).interference).toBe(false);
  });

  test('150 µT / 240° spike during a 90° turn: fused is 22.5°, 45.0°, 90.0° and trust returns at 3400 ms', () => {
    const times = clock(0, 4000);
    const fused = fuseHeading(
      gyroAt(times, (t) => (t >= 1000 && t < 3000 ? 45 : 0)),
      magAt(times, (t) => {
        if (t >= 1000 && t < 3000) return field(240, 3);
        if (t >= 3000) return east();
        return north();
      }),
    );

    expect(times).toHaveLength(201);
    expect(at(fused, 0)).toMatchObject({
      heading: 0,
      magneticHeading: 0,
      magnitudeUt: 50,
      interference: false,
      gyroOnly: false,
    });
    expect(at(fused, 1000).heading).toBeCloseTo(0, 6);
    expect(at(fused, 1000).magneticHeading).toBeCloseTo(240, 5);
    expect(at(fused, 1000).magnitudeUt).toBeCloseTo(150, 5);
    expect(at(fused, 1000).interference).toBe(true);
    expect(at(fused, 1500).heading).toBeCloseTo(22.5, 6);
    expect(at(fused, 2000).heading).toBeCloseTo(45, 6);
    expect(at(fused, 2000).magneticHeading).toBeCloseTo(240, 5);
    expect(at(fused, 2000)).toMatchObject({ interference: true, gyroOnly: true });
    expect(at(fused, 3000).heading).toBeCloseTo(90, 6);
    expect(at(fused, 3000)).toMatchObject({
      magneticHeading: 90,
      magnitudeUt: 50,
      interference: true,
      gyroOnly: true,
    });
    expect(at(fused, 3380)).toMatchObject({ interference: true, gyroOnly: true });
    expect(at(fused, 3400).heading).toBeCloseTo(90, 6);
    expect(at(fused, 3400)).toMatchObject({
      magneticHeading: 90,
      interference: false,
      gyroOnly: false,
    });
    expect(at(fused, 4000).heading).toBeCloseTo(90, 6);
    expect(at(fused, 4000).interference).toBe(false);
  });

  test('3.0°/s for 10.0 s: no mag or 200 µT ends at 30.0°; a healthy field ends near 0.86°', () => {
    const times = clock(0, 10000);
    const gyro = gyroAt(times, 3);
    const gyroOnly = fuseHeading(gyro, []);
    const saturated = fuseHeading(gyro, magAt(times, north(4)));
    const corrected = fuseHeading(gyro, magAt(times, north()));

    expect(times).toHaveLength(501);
    expect(at(gyroOnly, 0)).toMatchObject({
      heading: 0,
      gyroOnly: true,
      interference: false,
      magneticHeading: null,
    });
    expect(at(gyroOnly, 5000).heading).toBeCloseTo(15, 6);
    expect(at(gyroOnly, 10000).heading).toBeCloseTo(30, 6);
    expect(at(gyroOnly, 10000).gyroOnly).toBe(true);

    expect(at(saturated, 0).magnitudeUt).toBe(200);
    expect(at(saturated, 0)).toMatchObject({ interference: true, gyroOnly: true, heading: 0 });
    expect(at(saturated, 10000).heading).toBeCloseTo(30, 6);
    expect(at(saturated, 10000)).toMatchObject({ interference: true, gyroOnly: true });

    expect(at(corrected, 0)).toMatchObject({
      heading: 0,
      interference: false,
      gyroOnly: false,
      magnitudeUt: 50,
    });
    expect(at(corrected, 10000).heading).toBeCloseTo(0.8578, 3);
    expect(at(corrected, 10000)).toMatchObject({ interference: false, gyroOnly: false });
  });

  test('magnetometer at 10 Hz still bounds the same 3.0°/s bias, near 0.84° at 10.0 s', () => {
    const gyroTimes = clock(0, 10000, 20);
    const magTimes = clock(0, 10000, 100);
    const fused = fuseHeading(gyroAt(gyroTimes, 3), magAt(magTimes, north()));

    expect(gyroTimes).toHaveLength(501);
    expect(magTimes).toHaveLength(101);
    expect(fused).toHaveLength(501);
    expect(at(fused, 0).heading).toBe(0);
    expect(at(fused, 20)).toMatchObject({
      magneticHeading: null,
      magnitudeUt: null,
      gyroOnly: false,
      interference: false,
    });
    expect(at(fused, 10000).heading).toBeCloseTo(0.8419, 3);
    expect(at(fused, 10000).magneticHeading).toBe(0);
  });

  test('heading wraps through north: 350° plus 30°/s for 1 s is 20°', () => {
    const times = clock(0, 1000);
    const fused = fuseHeading(
      gyroAt(times, 30),
      magAt(times, (t) => field(350 + 30 * (t / 1000))),
    );

    expect(at(fused, 0).heading).toBeCloseTo(350, 5);
    expect(at(fused, 320).heading).toBeCloseTo(359.6, 3);
    expect(at(fused, 340).heading).toBeCloseTo(0.2, 3);
    expect(at(fused, 1000).heading).toBeCloseTo(20, 4);
    expect(fused.every((sample) => sample.heading >= 0 && sample.heading < 360)).toBe(true);
    expect(fused.every((sample) => !sample.interference)).toBe(true);
  });

  test('gyro-only from 10° at −20°/s wraps to 350° in 1 s', () => {
    const times = clock(0, 1000);
    const fused = fuseHeading(gyroAt(times, -20), [], { initialHeadingDeg: 10 });

    expect(at(fused, 0).heading).toBe(10);
    expect(at(fused, 1000).heading).toBeCloseTo(350, 6);
    expect(at(fused, 1000)).toMatchObject({ gyroOnly: true, interference: false });
  });

  test('a vertical 50 µT field has no heading; 10°/s of yaw still integrates to 10°', () => {
    const times = clock(0, 1000);
    const fused = fuseHeading(gyroAt(times, 10), magAt(times, { x: 0, y: 0, z: 50 }));

    expect(at(fused, 0)).toMatchObject({
      heading: 0,
      magneticHeading: null,
      magnitudeUt: 50,
      gyroOnly: true,
      interference: false,
    });
    expect(at(fused, 1000).heading).toBeCloseTo(10, 6);
    expect(at(fused, 1000).magneticHeading).toBe(null);
  });

  test('shuffled streams match time order and the inputs are not mutated', () => {
    const times = clock(0, 4000);
    const gyro = gyroAt(times, (t) => (t >= 1000 && t < 3000 ? 45 : 0));
    const mag = magAt(times, (t) => {
      if (t >= 1000 && t < 3000) return field(240, 3);
      if (t >= 3000) return east();
      return north();
    });
    const gyroBefore = gyro.map((sample) => ({ ...sample }));
    const magBefore = mag.map((sample) => ({ ...sample }));
    const forward = fuseHeading(gyro, mag);
    const reversed = fuseHeading(gyro.slice().reverse(), mag.slice().reverse());

    expect(reversed).toEqual(forward);
    expect(gyro).toEqual(gyroBefore);
    expect(mag).toEqual(magBefore);
    expect(at(forward, 2000).heading).toBeCloseTo(45, 6);
  });

  test('a tilt brake holds the heading; a measured 0 rad/s integrates minus the bias', () => {
    const times = clock(0, 10000);
    const gyro = gyroAt(times, 3);
    const mag = magAt(times, north());
    const brake = fuseHeading(
      [...gyro, { t: 10000, brake: true }, { t: 12000, yawRate: yaw(90) }],
      mag,
    );
    const still = fuseHeading(
      [...gyro, { t: 10000, yawRate: 0 }, { t: 12000, yawRate: yaw(90) }],
      mag,
    );
    const bias = 3 * (1 - Math.exp(-10 / 5));
    const wrapped = (deg: number) => {
      const turn = ((deg % 360) + 360) % 360;
      return turn === 0 ? 0 : turn;
    };

    expect(at(brake, 12000).heading).toBeCloseTo(at(brake, 10000).heading, 6);
    expect(at(still, 12000).heading).toBeCloseTo(wrapped(at(still, 10000).heading - bias * 2), 4);
  });
});

describe('getEngine', () => {
  test('serves the demo snapshot until a sample; mockEngine keeps the static walk', () => {
    const snapshot = getEngine().getSnapshot();
    expect(snapshot.heading).toBe(90);
    expect(snapshot.stepCount).toBe(12);
    expect(snapshot.rawPath).toHaveLength(7);
    expect(snapshot).toEqual(mockEngine.getSnapshot());

    const mock = mockEngine.getSnapshot();
    expect(mock.heading).toBe(90);
    expect(mock.stepCount).toBe(12);
    expect(typeof fuseHeading).toBe('function');
  });
});
