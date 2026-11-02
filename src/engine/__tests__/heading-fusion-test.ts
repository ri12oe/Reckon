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
  test('empty, non-finite, and a single east sample does not fix (before: latched 90°)', () => {
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
      heading: 0,
      gyroOnly: true,
      interference: false,
      magneticHeading: 90,
      magnitudeUt: 50,
    });
  });

  test('one in-range sample at 0 ms stays 0° gyro-only (before: latched 90°)', () => {
    const fused = fuseHeading([{ t: 0, yawRate: 0 }], [{ t: 0, ...east() }]);

    expect(fused).toHaveLength(1);
    expect(fused[0]).toMatchObject({
      t: 0,
      heading: 0,
      gyroOnly: true,
      interference: false,
      magneticHeading: 90,
      magnitudeUt: 50,
    });
  });

  test('an 80° sample at 0 ms then stable north stays 0° and trusts north at 420 ms (before: latched 80° and stayed gyro-only)', () => {
    const times = clock(0, 2000);
    const fused = fuseHeading(
      gyroAt(times, 0),
      magAt(times, (t) => (t === 0 ? field(80) : north())),
    );

    expect(at(fused, 0)).toMatchObject({
      heading: 0,
      magneticHeading: 80,
      magnitudeUt: 50,
      gyroOnly: true,
      interference: false,
    });
    expect(at(fused, 400)).toMatchObject({
      heading: 0,
      magneticHeading: 0,
      gyroOnly: true,
      interference: false,
    });
    expect(at(fused, 420)).toMatchObject({
      heading: 0,
      magneticHeading: 0,
      magnitudeUt: 50,
      gyroOnly: false,
      interference: false,
    });
    expect(at(fused, 2000)).toMatchObject({
      heading: 0,
      magneticHeading: 0,
      gyroOnly: false,
      interference: false,
    });
  });

  test('level cardinals: 51 samples at 50 Hz lock at 400 ms (before: locked at 0 ms)', () => {
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
        expect(sample.magneticHeading).toBe(heading);
        expect(sample.magnitudeUt).toBe(50);
        expect(sample.interference).toBe(false);
        if (sample.t < DEFAULT_HEADING_FUSION_CONFIG.recoverHoldMs) {
          expect(sample.heading).toBe(0);
          expect(sample.gyroOnly).toBe(true);
        } else {
          expect(sample.heading).toBe(heading);
          expect(sample.gyroOnly).toBe(false);
        }
      }
    }
  });

  test('3 Hz cross-axis noise locks at 480 ms; compass 75.10°–104.90°, fused 89.35°–90.49° (before an instant lock: 89.46°–90.53°)', () => {
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
    expect(at(fused, 0)).toMatchObject({
      heading: 0,
      magneticHeading: 90,
      gyroOnly: true,
      interference: false,
    });
    expect(at(fused, 460).gyroOnly).toBe(true);
    expect(at(fused, 480).gyroOnly).toBe(false);
    expect(at(fused, 480).heading).toBeCloseTo(at(fused, 480).magneticHeading ?? 0, 6);
    expect(magMin).toBeCloseTo(75.0967, 4);
    expect(magMax).toBeCloseTo(104.9033, 4);
    expect(fusedMin).toBeCloseTo(89.352446, 6);
    expect(fusedMax).toBeCloseTo(90.494339, 6);
    expect(Math.max(90 - magMin, magMax - 90)).toBeCloseTo(14.9033, 4);
    expect(Math.max(90 - fusedMin, fusedMax - 90)).toBeCloseTo(0.647554, 6);
    expect(settled.every((sample) => !sample.interference && !sample.gyroOnly)).toBe(true);
  });

  test('a stable field 80° off the pre-hold heading stays gyro-only', () => {
    const times = clock(0, 5000);
    const gyro = gyroAt(times, 0);
    const mag = magAt(times, (t) => (t >= 1000 && t <= 3000 ? field(80) : north()));
    const held = fuseHeading(gyro, mag);
    const trusted = fuseHeading(gyro, mag, OPEN_ANGLE_GATES);

    expect(times).toHaveLength(251);
    expect(at(held, 980)).toMatchObject({
      heading: 0,
      magneticHeading: 0,
      interference: false,
      gyroOnly: false,
    });
    expect(at(held, 1380)).toMatchObject({
      heading: 0,
      magneticHeading: 80,
      interference: true,
      gyroOnly: true,
    });
    expect(at(held, 1400)).toMatchObject({
      heading: 0,
      magneticHeading: 80,
      magnitudeUt: 50,
      interference: true,
      gyroOnly: true,
    });
    expect(at(held, 2000)).toMatchObject({ heading: 0, interference: true, gyroOnly: true });
    expect(at(held, 3000)).toMatchObject({ heading: 0, interference: true, gyroOnly: true });
    expect(at(held, 3400)).toMatchObject({ heading: 0, interference: true, gyroOnly: true });
    expect(at(held, 3420)).toMatchObject({
      heading: 0,
      magneticHeading: 0,
      interference: false,
      gyroOnly: false,
    });
    expect(at(held, 4000)).toMatchObject({
      heading: 0,
      interference: false,
      gyroOnly: false,
    });

    expect(at(trusted, 1400).heading).toBeCloseTo(19.5373, 4);
    expect(at(trusted, 1400)).toMatchObject({ interference: false, gyroOnly: false });
    expect(at(trusted, 2000).heading).toBeCloseTo(39.4706, 4);
    expect(at(trusted, 3000).heading).toBeCloseTo(59.1915, 4);
    expect(at(trusted, 3000).interference).toBe(false);
  });

  test('a clean field 20° off the pre-hold heading reacquires after the hold', () => {
    const times = clock(0, 4000);
    const saturated = { x: 120, y: 0, z: 160 };
    const fused = fuseHeading(
      gyroAt(times, 0),
      magAt(times, (t) => {
        if (t >= 1000 && t < 1400) return saturated;
        if (t >= 1400) return field(20);
        return north();
      }),
    );

    expect(at(fused, 980)).toMatchObject({
      heading: 0,
      magnitudeUt: 50,
      interference: false,
      gyroOnly: false,
    });
    expect(at(fused, 1000)).toMatchObject({
      heading: 0,
      magnitudeUt: 200,
      interference: true,
      gyroOnly: true,
    });
    expect(at(fused, 1780)).toMatchObject({
      heading: 0,
      magneticHeading: 20,
      interference: true,
      gyroOnly: true,
    });
    expect(at(fused, 1800).heading).toBeCloseTo(8.4225, 4);
    expect(at(fused, 1800)).toMatchObject({
      magneticHeading: 20,
      magnitudeUt: 50,
      interference: false,
      gyroOnly: false,
    });
    expect(at(fused, 3000).heading).toBeCloseTo(14.7979, 4);
    expect(at(fused, 3000)).toMatchObject({ interference: false, gyroOnly: false });
    expect(at(fused, 4000).heading).toBeCloseTo(17.3291, 4);
    expect(at(fused, 4000).gyroOnly).toBe(false);
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
      gyroOnly: true,
    });
    expect(at(fused, 400)).toMatchObject({
      heading: 0,
      magneticHeading: 0,
      gyroOnly: false,
      interference: false,
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

  test('3.0°/s for 10.0 s: no mag or 200 µT ends at 30.0°; a healthy field ends near 0.93° (before an instant lock: 0.86°)', () => {
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
      gyroOnly: true,
      magnitudeUt: 50,
    });
    expect(at(corrected, 400)).toMatchObject({
      heading: 0,
      interference: false,
      gyroOnly: false,
    });
    expect(at(corrected, 10000).heading).toBeCloseTo(0.92745, 5);
    expect(at(corrected, 10000)).toMatchObject({ interference: false, gyroOnly: false });
  });

  test('magnetometer at 10 Hz still bounds the same 3.0°/s bias, near 0.91° at 10.0 s (before an instant lock: 0.84°)', () => {
    const gyroTimes = clock(0, 10000, 20);
    const magTimes = clock(0, 10000, 100);
    const fused = fuseHeading(gyroAt(gyroTimes, 3), magAt(magTimes, north()));

    expect(gyroTimes).toHaveLength(501);
    expect(magTimes).toHaveLength(101);
    expect(fused).toHaveLength(501);
    expect(at(fused, 0).heading).toBe(0);
    expect(at(fused, 20).heading).toBeCloseTo(0.06, 6);
    expect(at(fused, 20)).toMatchObject({
      magneticHeading: null,
      magnitudeUt: null,
      gyroOnly: true,
      interference: false,
    });
    expect(at(fused, 400)).toMatchObject({ heading: 0, gyroOnly: false, interference: false });
    expect(at(fused, 10000).heading).toBeCloseTo(0.9102, 4);
    expect(at(fused, 10000).magneticHeading).toBe(0);
  });

  test('a 350° field turning at 30°/s locks at 2° after 400 ms and is 20° at 1 s (before: 350° at 0 ms, 0.2° at 340 ms)', () => {
    const times = clock(0, 1000);
    const fused = fuseHeading(
      gyroAt(times, 30),
      magAt(times, (t) => field(350 + 30 * (t / 1000))),
    );

    expect(at(fused, 0)).toMatchObject({
      heading: 0,
      magneticHeading: 350,
      gyroOnly: true,
      interference: false,
    });
    expect(at(fused, 320).heading).toBeCloseTo(9.6, 4);
    expect(at(fused, 320).magneticHeading).toBeCloseTo(359.6, 3);
    expect(at(fused, 340).heading).toBeCloseTo(10.2, 4);
    expect(at(fused, 340).magneticHeading).toBeCloseTo(0.2, 3);
    expect(at(fused, 400)).toMatchObject({ gyroOnly: false, interference: false });
    expect(at(fused, 400).heading).toBeCloseTo(2, 4);
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

  test('90°/s at 50 Hz for 2 s still ends at 180°', () => {
    const times = clock(0, 2000);
    const fused = fuseHeading(gyroAt(times, 90), []);

    expect(times).toHaveLength(101);
    expect(at(fused, 20).heading).toBeCloseTo(1.8, 6);
    expect(at(fused, 1000).heading).toBeCloseTo(90, 6);
    expect(at(fused, 2000).heading).toBeCloseTo(180, 6);
  });

  test('90°/s for 1 s stays at 90° across a later 5 s gap', () => {
    const times = clock(0, 1000);
    const fused = fuseHeading([...gyroAt(times, 90), { t: 6000, yawRate: 0 }], []);

    expect(at(fused, 1000).heading).toBeCloseTo(90, 6);
    expect(at(fused, 6000).heading).toBeCloseTo(90, 6);
  });

  test('90°/s across a 1.5 s silent gap stays at 0° instead of adding 135°', () => {
    const fused = fuseHeading(
      [
        { t: 0, yawRate: yaw(90) },
        { t: 1500, yawRate: 0 },
      ],
      [],
    );

    expect(at(fused, 0).heading).toBe(0);
    expect(at(fused, 1500).heading).toBe(0);
  });

  test('90°/s across 150 ms adds 13.5° and across 151 ms adds nothing', () => {
    const held = fuseHeading(
      [
        { t: 0, yawRate: yaw(90) },
        { t: 150, yawRate: 0 },
      ],
      [],
    );
    const dropped = fuseHeading(
      [
        { t: 0, yawRate: yaw(90) },
        { t: 151, yawRate: 0 },
      ],
      [],
    );

    expect(at(held, 150).heading).toBeCloseTo(13.5, 6);
    expect(at(dropped, 151).heading).toBe(0);
  });

  test('mag before a trusted level frame stays at 0° with no hold; the same east field acquires 90° at 900 ms (before: 500 ms)', () => {
    const early = clock(0, 480);
    const late = clock(500, 1000);
    const fused = fuseHeading(gyroAt(clock(0, 1000), 0), [
      ...magAt(early, east()).map((sample) => ({ ...sample, levelReady: false as const })),
      ...magAt(late, east()),
    ]);

    expect(early).toHaveLength(25);
    expect(at(fused, 0)).toMatchObject({
      heading: 0,
      magneticHeading: 90,
      magnitudeUt: 50,
      gyroOnly: true,
      interference: false,
    });
    expect(at(fused, 480)).toMatchObject({
      heading: 0,
      magneticHeading: 90,
      magnitudeUt: 50,
      gyroOnly: true,
      interference: false,
    });
    expect(at(fused, 500)).toMatchObject({
      heading: 0,
      magneticHeading: 90,
      magnitudeUt: 50,
      gyroOnly: true,
      interference: false,
    });
    expect(at(fused, 880)).toMatchObject({
      heading: 0,
      gyroOnly: true,
      interference: false,
    });
    expect(at(fused, 900)).toMatchObject({
      heading: 90,
      magneticHeading: 90,
      magnitudeUt: 50,
      gyroOnly: false,
      interference: false,
    });
    expect(at(fused, 1000)).toMatchObject({
      heading: 90,
      gyroOnly: false,
      interference: false,
    });
  });

  test('200 µT before the level frame is ready stays at 0° and does not latch interference', () => {
    const times = clock(0, 1000);
    const fused = fuseHeading(
      gyroAt(times, 0),
      magAt(times, north(4)).map((sample) => ({ ...sample, levelReady: false as const })),
    );

    expect(at(fused, 0)).toMatchObject({
      heading: 0,
      magneticHeading: 0,
      magnitudeUt: 200,
      gyroOnly: true,
      interference: false,
    });
    expect(at(fused, 1000)).toMatchObject({
      heading: 0,
      magnitudeUt: 200,
      gyroOnly: true,
      interference: false,
    });
  });

  test('a tilt brake holds the heading; a measured 0 rad/s integrates minus the bias', () => {
    const times = clock(0, 10000);
    const gyro = gyroAt(times, 3);
    const mag = magAt(times, north());
    const brake = fuseHeading(
      [...gyro, { t: 10000, brake: true }, { t: 10150, yawRate: yaw(90) }],
      mag,
    );
    const still = fuseHeading(
      [...gyro, { t: 10000, yawRate: 0 }, { t: 10150, yawRate: yaw(90) }],
      mag,
    );
    const stalled = fuseHeading(
      [...gyro, { t: 10000, yawRate: 0 }, { t: 11500, yawRate: yaw(90) }],
      mag,
    );
    const learnedSeconds = 10 - DEFAULT_HEADING_FUSION_CONFIG.recoverHoldMs / 1000;
    const bias = 3 * (1 - Math.exp(-learnedSeconds / DEFAULT_HEADING_FUSION_CONFIG.biasTauSeconds));
    const wrapped = (deg: number) => {
      const turn = ((deg % 360) + 360) % 360;
      return turn === 0 ? 0 : turn;
    };

    expect(at(brake, 10150).heading).toBeCloseTo(at(brake, 10000).heading, 6);
    expect(at(still, 10150).heading).toBeCloseTo(
      wrapped(at(still, 10000).heading - bias * 0.15),
      4,
    );
    expect(at(stalled, 11500).heading).toBeCloseTo(at(stalled, 10000).heading, 6);
  });

  test('a 90° residual stays gyro-only at 4.9 s of clean mag and snaps to north at 8.0 s (before: still 90° and gyro-only at 12 s)', () => {
    const times = clock(0, 13200);
    const fused = fuseHeading(
      gyroAt(times, (t) => (t >= 1000 && t < 3000 ? 45 : 0)),
      magAt(times, (t) => {
        if (t >= 1000 && t < 3000) return north(4);
        if (t >= 8020) return field(80);
        return north();
      }),
    );

    expect(at(fused, 400)).toMatchObject({
      heading: 0,
      gyroOnly: false,
      interference: false,
    });
    expect(at(fused, 2000).heading).toBeCloseTo(45, 6);
    expect(at(fused, 2000)).toMatchObject({
      magnitudeUt: 200,
      gyroOnly: true,
      interference: true,
    });
    expect(at(fused, 3000).heading).toBeCloseTo(90, 6);
    expect(at(fused, 5000).heading).toBeCloseTo(90, 6);
    expect(at(fused, 5000)).toMatchObject({
      magneticHeading: 0,
      gyroOnly: true,
      interference: true,
    });
    expect(at(fused, 7980).heading).toBeCloseTo(90, 6);
    expect(at(fused, 7980)).toMatchObject({
      magneticHeading: 0,
      gyroOnly: true,
      interference: true,
    });
    expect(at(fused, 8000)).toMatchObject({
      heading: 0,
      magneticHeading: 0,
      magnitudeUt: 50,
      gyroOnly: false,
      interference: false,
    });
    expect(at(fused, 8420)).toMatchObject({
      heading: 0,
      magneticHeading: 80,
      gyroOnly: true,
      interference: true,
    });
    expect(at(fused, 13000)).toMatchObject({
      heading: 0,
      magneticHeading: 80,
      gyroOnly: true,
      interference: true,
    });
    expect(at(fused, 13020)).toMatchObject({
      heading: 80,
      magneticHeading: 80,
      gyroOnly: false,
      interference: false,
    });
  });

  test('29°/s against a still compass coasts under 0.5° in one quiet second (before: 17.6°)', () => {
    const spikeEnd = 6000;
    const coastStart = 6200;
    const coastEnd = 7200;
    const times = clock(0, coastEnd);
    const fused = fuseHeading(
      gyroAt(times, (t) => (t >= 1000 && t < spikeEnd ? 29 : 0)),
      magAt(
        times.filter((t) => t <= coastStart),
        north(),
      ),
    );
    const delta = wrap180(at(fused, coastEnd).heading - at(fused, coastStart).heading);

    expect(at(fused, 400)).toMatchObject({ gyroOnly: false, interference: false });
    expect(Math.abs(delta)).toBeLessThan(0.5);
  });

  test('a 200 ms burst at 200°/s coasts under 0.5° in one quiet second (before: 5.5°)', () => {
    const burstEnd = 1200;
    const coastStart = 1400;
    const coastEnd = 2400;
    const times = clock(0, coastEnd);
    const fused = fuseHeading(
      gyroAt(times, (t) => (t >= 1000 && t < burstEnd ? 200 : 0)),
      magAt(
        times.filter((t) => t <= coastStart),
        north(),
      ),
    );
    const delta = wrap180(at(fused, coastEnd).heading - at(fused, coastStart).heading);

    expect(Math.abs(delta)).toBeLessThan(0.5);
  });
});

function wrap180(deg: number): number {
  const wrapped = ((deg % 360) + 360) % 360;
  return wrapped > 180 ? wrapped - 360 : wrapped;
}

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
