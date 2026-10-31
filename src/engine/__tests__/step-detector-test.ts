import { getEngine, mockEngine } from '@/engine';
import {
  DEFAULT_STEP_DETECTOR_CONFIG,
  STANDARD_GRAVITY_MPS2,
  countSteps,
  detectSteps,
  type AccelMagnitudeSample,
  type AccelSample,
} from '@/engine/step-detector';

const HZ = 50;
const DT_MS = 1000 / HZ;

/** Inclusive sample clock at 50 Hz. 0..3000 is 151 samples. */
function sampleTimes(startMs: number, endMs: number): number[] {
  const times: number[] = [];
  for (let t = startMs; t <= endMs; t += DT_MS) times.push(t);
  return times;
}

/** Raised-cosine bump, zero outside ±halfWidthMs. Peak value is `amplitude`. */
function hannBump(t: number, center: number, amplitude: number, halfWidthMs: number): number {
  const dt = t - center;
  if (Math.abs(dt) > halfWidthMs) return 0;
  return amplitude * 0.5 * (1 + Math.cos((Math.PI * dt) / halfWidthMs));
}

function accel(t: number, x: number, y: number, z: number): AccelSample {
  return { t, x, y, z };
}

/**
 * Still phone: gravity along +z, no motion.
 * 0..3000 ms at 50 Hz → 151 samples.
 */
function standingSamples(endMs = 3000): AccelSample[] {
  return sampleTimes(0, endMs).map((t) => accel(t, 0, 0, STANDARD_GRAVITY_MPS2));
}

/** Bounded wobble, well under the 1.2 m/s² peak threshold. Same 151-sample clock. */
function noisyStandingSamples(endMs = 3000): AccelSample[] {
  return sampleTimes(0, endMs).map((t) => {
    const noise =
      0.15 * Math.sin(t * 0.05) + 0.1 * Math.sin(t * 0.13 + 1.2) + 0.08 * Math.sin(t * 0.031 + 0.4);
    return accel(t, noise * 0.2, noise * 0.1, STANDARD_GRAVITY_MPS2 + noise);
  });
}

function peaksEvery(firstMs: number, count: number, intervalMs: number): number[] {
  return Array.from({ length: count }, (_, i) => firstMs + i * intervalMs);
}

/** Vertical steps: gravity on z, Hann impact along z. */
function verticalWalk(peakTimes: number[], amplitude: number, halfWidthMs: number): AccelSample[] {
  const end = (peakTimes[peakTimes.length - 1] ?? 0) + halfWidthMs + 200;
  return sampleTimes(0, end).map((t) => {
    let bump = 0;
    for (const center of peakTimes) bump += hannBump(t, center, amplitude, halfWidthMs);
    return accel(t, 0, 0, STANDARD_GRAVITY_MPS2 + bump);
  });
}

/** Same impacts, phone on its side: gravity and the step both lie on x. */
function sidewaysWalk(peakTimes: number[], amplitude: number, halfWidthMs: number): AccelSample[] {
  const end = (peakTimes[peakTimes.length - 1] ?? 0) + halfWidthMs + 200;
  return sampleTimes(0, end).map((t) => {
    let bump = 0;
    for (const center of peakTimes) bump += hannBump(t, center, amplitude, halfWidthMs);
    return accel(t, STANDARD_GRAVITY_MPS2 + bump, 0, 0);
  });
}

function toMagnitudes(samples: readonly AccelSample[]): AccelMagnitudeSample[] {
  return samples.map((sample) => ({
    t: sample.t,
    magnitude: Math.hypot(sample.x, sample.y, sample.z),
  }));
}

describe('step detector defaults', () => {
  test('threshold, refractory gap, smoother, and gravity', () => {
    expect(DEFAULT_STEP_DETECTOR_CONFIG).toEqual({
      peakThreshold: 1.2,
      minIntervalMs: 300,
      smoothWindow: 5,
      gravity: 9.80665,
    });
  });
});

describe('detectSteps', () => {
  test('empty, single-sample, and non-finite input count 0 steps', () => {
    expect(countSteps([])).toBe(0);
    expect(countSteps([accel(0, 0, 0, STANDARD_GRAVITY_MPS2)])).toBe(0);
    expect(
      countSteps([
        accel(0, 0, 0, STANDARD_GRAVITY_MPS2),
        accel(Number.NaN, 0, 0, 30),
        accel(20, Number.POSITIVE_INFINITY, 0, 0),
        accel(40, 0, 0, STANDARD_GRAVITY_MPS2),
      ]),
    ).toBe(0);
  });

  test('quiet standing: 151 samples → 0 steps', () => {
    const samples = standingSamples(3000);
    expect(samples).toHaveLength(151);
    expect(countSteps(samples)).toBe(0);
    expect(detectSteps(samples)).toEqual([]);
  });

  test('sensor noise under the threshold: 151 samples → 0 steps', () => {
    const samples = noisyStandingSamples(3000);
    expect(samples).toHaveLength(151);
    const peakNoise = Math.max(
      ...samples.map((sample) => Math.hypot(sample.x, sample.y, sample.z) - STANDARD_GRAVITY_MPS2),
    );
    expect(peakNoise).toBeLessThan(DEFAULT_STEP_DETECTOR_CONFIG.peakThreshold);
    expect(countSteps(samples)).toBe(0);
  });

  test('ten weak 0.4 m/s² bumps stay below the threshold → 0 steps', () => {
    const planted = peaksEvery(500, 10, 500);
    const samples = verticalWalk(planted, 0.4, 160);
    expect(countSteps(samples)).toBe(0);
  });

  test('a one-sample 4 m/s² glitch is smoothed away → 0 steps', () => {
    const samples = standingSamples(1000);
    const spike = samples[25];
    expect(spike).toBeDefined();
    spike!.z += 4;
    expect(countSteps(samples)).toBe(0);
  });

  test('synthetic walk: 519 samples, 20 peaks → 20 steps, at the planted times', () => {
    const planted = peaksEvery(500, 20, 500);
    const samples = verticalWalk(planted, 3, 160);
    const steps = detectSteps(samples);

    expect(samples).toHaveLength(519);
    expect(steps).toHaveLength(20);
    expect(countSteps(samples)).toBe(20);
    expect(steps.map((step) => step.t)).toEqual(planted);
    expect(Math.min(...steps.map((step) => step.peakMps2))).toBeGreaterThan(1.2);
  });

  test('the same 20 peaks on a sideways phone still count as 20', () => {
    const planted = peaksEvery(500, 20, 500);
    const steps = detectSteps(sidewaysWalk(planted, 3, 160));
    expect(steps.map((step) => step.t)).toEqual(planted);
  });

  test('magnitude samples match the axis samples: 20 → 20', () => {
    const planted = peaksEvery(500, 20, 500);
    const axes = verticalWalk(planted, 3, 160);
    const fromAxes = detectSteps(axes);
    const fromMagnitude = detectSteps(toMagnitudes(axes));
    expect(fromMagnitude).toEqual(fromAxes);
    expect(fromMagnitude).toHaveLength(20);
  });

  test('shuffled samples are sorted by time and still count 20', () => {
    const planted = peaksEvery(500, 20, 500);
    const samples = verticalWalk(planted, 3, 160);
    const shuffled = samples.slice().reverse();
    expect(detectSteps(shuffled).map((step) => step.t)).toEqual(planted);
  });

  test('detectSteps does not mutate the input array', () => {
    const samples = verticalWalk(peaksEvery(500, 4, 500), 3, 160);
    const before = samples.map((sample) => ({ ...sample }));
    detectSteps(samples);
    expect(samples).toEqual(before);
  });

  test('a 12-cycle sinusoid (301 samples) counts 12 steps, not 24 half-cycles', () => {
    const periodMs = 500;
    const cycles = 12;
    const samples = sampleTimes(0, cycles * periodMs).map((t) =>
      accel(t, 0, 0, STANDARD_GRAVITY_MPS2 + 2.8 * Math.sin((2 * Math.PI * t) / periodMs)),
    );
    const steps = detectSteps(samples);

    expect(samples).toHaveLength((cycles * periodMs) / DT_MS + 1);
    expect(steps).toHaveLength(12);
    expect(steps.map((step) => step.t)).toEqual(peaksEvery(120, 12, periodMs));
  });

  test('quiet two seconds, then 8 steps: 0 during the quiet prefix, 8 overall', () => {
    const planted = peaksEvery(2500, 8, 500);
    const samples = verticalWalk(planted, 3, 160);
    const steps = detectSteps(samples);
    const duringQuiet = steps.filter((step) => step.t < 2000);

    expect(samples).toHaveLength(319);
    expect(duringQuiet).toHaveLength(0);
    expect(steps).toHaveLength(8);
    expect(steps.map((step) => step.t)).toEqual(planted);
  });

  test('heel plus toe: 10 steps × 2 peaks → 20 with a short gap, 10 with the default gap', () => {
    const primaries = peaksEvery(800, 10, 800);
    const peakTimes = primaries.flatMap((t) => [t, t + 280]);
    const end = peakTimes[peakTimes.length - 1]! + 200;
    const samples = sampleTimes(0, end).map((t) => {
      let bump = 0;
      for (const center of primaries) {
        bump += hannBump(t, center, 3.2, 90);
        bump += hannBump(t, center + 280, 2.6, 90);
      }
      return accel(t, 0, 0, STANDARD_GRAVITY_MPS2 + bump);
    });

    const bothPeaks = detectSteps(samples, { minIntervalMs: 100 });
    const steps = detectSteps(samples);

    expect(samples).toHaveLength(425);
    expect(bothPeaks).toHaveLength(20);
    expect(bothPeaks.map((step) => step.t)).toEqual(peakTimes);
    expect(steps).toHaveLength(10);
    expect(steps.map((step) => step.t)).toEqual(primaries);
  });

  test('8 peaks 200 ms apart: default refractory keeps 4, a 150 ms gap keeps 8', () => {
    const planted = peaksEvery(400, 8, 200);
    const samples = verticalWalk(planted, 3, 70);

    expect(samples).toHaveLength(104);
    expect(detectSteps(samples).map((step) => step.t)).toEqual([400, 800, 1200, 1600]);
    expect(countSteps(samples)).toBe(4);
    expect(detectSteps(samples, { minIntervalMs: 150 }).map((step) => step.t)).toEqual(planted);
    expect(countSteps(samples, { minIntervalMs: 150 })).toBe(8);
  });

  test('gravity-free magnitudes need gravity: 0 — otherwise 5 peaks count as 0', () => {
    const planted = peaksEvery(500, 5, 500);
    const samples: AccelMagnitudeSample[] = sampleTimes(0, 500 + 4 * 500 + 400).map((t) => {
      let bump = 0;
      for (const center of planted) bump += hannBump(t, center, 2.5, 160);
      return { t, magnitude: bump };
    });

    expect(samples).toHaveLength(146);
    expect(countSteps(samples)).toBe(0);
    expect(detectSteps(samples, { gravity: 0 }).map((step) => step.t)).toEqual(planted);
  });
});

describe('getEngine', () => {
  test('serves the demo snapshot until a sample; mockEngine keeps the static walk', () => {
    const snapshot = getEngine().getSnapshot();
    const mock = mockEngine.getSnapshot();
    expect(snapshot).toEqual(mock);
    expect(snapshot).not.toBe(mock);
    expect(snapshot.stepCount).toBe(12);
    expect(snapshot.heading).toBe(90);
    expect(snapshot.rawPath).toHaveLength(7);
    expect(snapshot.correctedPath).toHaveLength(7);
    expect(snapshot.pins.map((pin) => pin.id)).toEqual(['door', 'desk']);

    expect(mock.stepCount).toBe(12);
    expect(mock.heading).toBe(90);
    expect(mock.rawPath).toHaveLength(7);
    expect(mock.correctedPath).toHaveLength(7);
    expect(mock.pins.map((pin) => pin.id)).toEqual(['door', 'desk']);
  });
});
