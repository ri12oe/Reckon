import { correctDrift } from '@/engine/drift-correction';
import {
  FUSION_PENDING_HOLD,
  createHeadingFusion,
  fuseHeading,
  type GyroSample,
  type MagSample,
} from '@/engine/heading-fusion';
import { HEADING_SAMPLE_CAP, createLiveEngine } from '@/engine/live-engine';
import { integratePath } from '@/engine/path-integration';
import {
  STEP_SAMPLE_CAP,
  STANDARD_GRAVITY_MPS2,
  createStepAccumulator,
  detectSteps,
  type AccelSample,
  type StepEvent,
} from '@/engine/step-detector';

const DT_MS = 20;
const RAD = Math.PI / 180;

function field(headingDeg: number): { x: number; y: number; z: number } {
  const heading = headingDeg * RAD;
  return { x: 30 * Math.cos(heading), y: -30 * Math.sin(heading), z: 40 };
}

function hannBump(t: number, center: number, amplitude: number, halfWidthMs: number): number {
  const dt = t - center;
  if (Math.abs(dt) > halfWidthMs) return 0;
  return amplitude * 0.5 * (1 + Math.cos((Math.PI * dt) / halfWidthMs));
}

function verticalWalk(peakTimes: readonly number[]): AccelSample[] {
  const end = (peakTimes[peakTimes.length - 1] ?? 0) + 160 + 200;
  const samples: AccelSample[] = [];
  for (let t = 0; t <= end; t += DT_MS) {
    let bump = 0;
    for (const center of peakTimes) bump += hannBump(t, center, 3, 160);
    samples.push({ t, x: 0, y: 0, z: STANDARD_GRAVITY_MPS2 + bump });
  }
  return samples;
}

/** Step times are the path. A suffix sum can disagree with a full-series sum by an ulp. */
function expectSteps(actual: readonly StepEvent[], expected: readonly StepEvent[]): void {
  expect(actual.map((step) => step.t)).toEqual(expected.map((step) => step.t));
  for (let index = 0; index < expected.length; index++) {
    expect(actual[index]!.peakMps2).toBeCloseTo(expected[index]!.peakMps2, 8);
  }
}

describe('incremental step detection', () => {
  const planted = Array.from({ length: 40 }, (_, index) => 400 + index * 400);
  const samples = verticalWalk(planted);

  test('streaming in order matches a full detectSteps pass, and the buffer stays capped', () => {
    expect(samples.length).toBeGreaterThan(STEP_SAMPLE_CAP);
    const acc = createStepAccumulator();
    const seen: AccelSample[] = [];
    for (const sample of samples) {
      seen.push(sample);
      acc.push(sample);
      if (seen.length % 50 === 0) expectSteps(acc.steps(), detectSteps(seen));
    }
    expectSteps(acc.steps(), detectSteps(samples));
    expect(acc.retained()).toBeLessThanOrEqual(STEP_SAMPLE_CAP);
    expect(acc.retained()).toBeLessThan(samples.length);
  });

  test('a reversed batch still matches while the whole series fits', () => {
    const acc = createStepAccumulator();
    for (const sample of samples.slice().reverse()) acc.push(sample);
    expect(acc.steps()).toEqual(detectSteps(samples));
  });
});

describe('incremental heading fusion', () => {
  test('folding each sample matches fuseHeading, including a magnetometer that arrives late', () => {
    const times = Array.from({ length: 500 }, (_, index) => index * DT_MS);
    const gyros: GyroSample[] = times.map((t) => ({
      t,
      yawRate: t < 2000 ? 20 * RAD : 0,
    }));
    const mags: MagSample[] = times.map((t) => ({ t, ...field(t < 2000 ? 0 : 40) }));
    const batch = fuseHeading(gyros, mags);
    const ingest = createHeadingFusion();
    const produced = [];
    const delay = 8;
    for (let index = 0; index < times.length; index++) {
      produced.push(...ingest.pushGyro(gyros[index]!).headings);
      if (index >= delay) produced.push(...ingest.pushMag(mags[index - delay]!).headings);
    }
    for (let index = times.length - delay; index < times.length; index++) {
      produced.push(...ingest.pushMag(mags[index]!).headings);
    }
    const fused = produced.concat(ingest.replayPending().headings);

    expect(fused).toHaveLength(batch.length);
    for (let index = 0; index < batch.length; index++) {
      expect(fused[index]!.t).toBe(batch[index]!.t);
      expect(fused[index]!.heading).toBeCloseTo(batch[index]!.heading, 9);
      expect(fused[index]!.gyroOnly).toBe(batch[index]!.gyroOnly);
    }
    expect(ingest.pendingCount()).toBeLessThanOrEqual(FUSION_PENDING_HOLD);
  });
});

describe('live engine ingest', () => {
  test('a long east walk keeps snapshot cost flat and the same end pose', () => {
    const chunk = 400;
    const chunks = 20;
    const total = chunk * chunks;
    const accels: AccelSample[] = [];
    const gyros: GyroSample[] = [];
    const mags: MagSample[] = [];
    for (let index = 0; index < total; index++) {
      const t = index * DT_MS;
      let bump = 0;
      for (let peak = 400; peak < total * DT_MS; peak += 500) {
        if (Math.abs(t - peak) <= 160) bump += hannBump(t, peak, 3, 160);
      }
      accels.push({ t, x: 0, y: 0, z: STANDARD_GRAVITY_MPS2 + bump });
      gyros.push({ t, yawRate: 0 });
      mags.push({ t, ...field(90) });
    }

    const engine = createLiveEngine();
    const examined: number[] = [];
    for (let index = 0; index < chunks; index++) {
      const start = index * chunk;
      const end = start + chunk;
      for (let sample = start; sample < end; sample++) {
        engine.pushAccel(accels[sample]!);
        engine.pushGyro(gyros[sample]!);
        engine.pushMag(mags[sample]!);
      }
      engine.getSnapshot();
      examined.push(engine.bufferStats().examined);
    }

    const steps = detectSteps(accels).map((step) => ({ t: step.t }));
    const fused = fuseHeading(gyros, mags).map((sample) => ({
      t: sample.t,
      heading: sample.heading,
    }));
    const raw = integratePath(steps, fused);
    const corrected = correctDrift(raw, { corridor: true });
    const snapshot = engine.getSnapshot();
    const endRaw = raw[raw.length - 1]!;
    const endCorrected = corrected.corrected[corrected.corrected.length - 1]!;
    const stats = engine.bufferStats();

    expect(snapshot.stepCount).toBe(steps.length);
    expect(snapshot.heading).toBeCloseTo(fused[fused.length - 1]!.heading, 8);
    expect(snapshot.rawPath[snapshot.rawPath.length - 1]!.x).toBeCloseTo(endRaw.x, 8);
    expect(snapshot.rawPath[snapshot.rawPath.length - 1]!.y).toBeCloseTo(endRaw.y, 8);
    expect(snapshot.correctedPath[snapshot.correctedPath.length - 1]!.x).toBeCloseTo(
      endCorrected.x,
      8,
    );
    expect(snapshot.correctedPath[snapshot.correctedPath.length - 1]!.y).toBeCloseTo(
      endCorrected.y,
      8,
    );

    const maxExamined = Math.max(...examined);
    const totalImu = accels.length + gyros.length + mags.length;
    expect(maxExamined).toBeLessThan(totalImu / 5);
    expect(examined[examined.length - 1]!).toBeLessThan(examined[1]! * 2);
    expect(stats.accelRetained).toBeLessThanOrEqual(STEP_SAMPLE_CAP);
    expect(stats.fusionPending).toBeLessThanOrEqual(FUSION_PENDING_HOLD);
    expect(stats.headingRetained).toBeLessThanOrEqual(HEADING_SAMPLE_CAP);
    expect(stats.headingRetained).toBeLessThan(fused.length);

    console.log(
      JSON.stringify({
        samplesPerChannel: total,
        totalImu,
        examinedBySnapshot: examined,
        maxExamined,
        fullHistoryWouldExamine: totalImu,
        buffers: stats,
        steps: snapshot.stepCount,
        heading: snapshot.heading,
        rawEnd: snapshot.rawPath[snapshot.rawPath.length - 1],
        correctedEnd: snapshot.correctedPath[snapshot.correctedPath.length - 1],
        referenceRawEnd: endRaw,
        referenceCorrectedEnd: endCorrected,
      }),
    );
  });

  test('the noisy 4 m square still closes: heading 265°, raw (0.052, −0.121), corrected (0, 0)', () => {
    const headings = [6, -4, 8, 2, 95, 87, 97, 91, 184, 174, 183, 188, 268, 276, 274, 265];
    const engine = createLiveEngine({ stepLengthM: 1 });
    for (const [index, heading] of headings.entries()) {
      engine.pushStep({ t: (index + 1) * 500, heading });
    }
    const snapshot = engine.getSnapshot();
    expect(snapshot.heading).toBe(265);
    expect(snapshot.rawPath[16]!.x).toBeCloseTo(0.051654128412, 9);
    expect(snapshot.rawPath[16]!.y).toBeCloseTo(-0.121150546521, 9);
    expect(snapshot.correctedPath[16]!.x).toBeCloseTo(0, 9);
    expect(snapshot.correctedPath[16]!.y).toBeCloseTo(0, 9);
  });
});
