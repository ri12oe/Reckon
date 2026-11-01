import { createLiveEngine, magneticHeadingDeg, type LiveFloorwalkerEngine } from '@/engine';
import {
  attitudeIsLevel,
  LEVEL_MAX_TILT_FROM_HORIZONTAL_DEG,
  levelMagnetometer,
  tiltFromHorizontalDeg,
  worldDown,
  yawAboutDown,
  type AccelAtRest,
  type Vec3,
} from '@/engine/level-attitude';
import type { MotionSensor, SensorMeasurement } from '@/engine/sensor-feed';
import { STANDARD_GRAVITY_MPS2 } from '@/engine/step-detector';

/**
 * Device-frame simulation for a phone pitched up from flat and walked
 * around a square. Conventions match expo-sensors / the engine:
 *
 * Device axes (iOS Core Motion and Android SensorManager, portrait):
 * +x right, +y toward the top of the phone, +z out of the screen.
 *
 * Navigation frame is NED: +x north, +y east, +z down. Heading is
 * clockwise from north, the engine's heading.
 *
 * Pose, built in that order:
 * 1. Flat, screen up, top of the phone pointing north. Device +z is up,
 *    so world-down in the device frame is (0, 0, −1).
 * 2. Clockwise heading ψ about world-down.
 * 3. Pitch θ about the device's right axis, lifting the top of the phone.
 *    θ = 0 is flat. θ = 90° stands the phone up, top toward the sky,
 *    screen facing the walker.
 *
 * iOS accelerometer at rest reads the gravity vector (world-down), in g.
 * Android reads the opposite specific force; the Android run negates the
 * iOS vector and passes `accelAtRest: 'up'`.
 * Gyro is the right-handed rate in the device frame, rad/s.
 * Magnetometer is the Earth field in the device frame, µT. The field used
 * here is 30 µT north and 40 µT down (|B| = 50).
 *
 * A clockwise heading rate ψ̇ then has device components
 *   (0, −ψ̇ sin θ, −ψ̇ cos θ).
 * Flat (θ = 0) that is (0, 0, −ψ̇), and the old feed's −device.z equals ψ̇.
 * Upright, the rate sits on device y, which −device.z misses.
 */

const G = STANDARD_GRAVITY_MPS2;
const DT_MS = 20;
const DEG = Math.PI / 180;
const BN = 30;
const BD = 40;
const STEP_AMP = 3;
const STEP_HALF_MS = 160;

const CARDINALS = [0, 90, 180, 270];

type Leg = {
  heading: number;
  steps: number[];
  checkT: number;
  turnStart: number;
  turnEnd: number;
};

type DeviceSample = {
  t: number;
  accel: SensorMeasurement;
  gyro: SensorMeasurement;
  mag: SensorMeasurement;
  /** Leg index whose heading and position to record after this sample. */
  mark: number | null;
};

type SquareResult = {
  steps: number;
  headings: number[];
  legEnds: { x: number; y: number }[];
  final: { x: number; y: number };
  errorM: number;
};

function hann(t: number, center: number, amplitude: number, halfWidthMs: number): number {
  const dt = t - center;
  if (Math.abs(dt) > halfWidthMs) return 0;
  return amplitude * 0.5 * (1 + Math.cos((Math.PI * dt) / halfWidthMs));
}

/** Four 4 m legs and three 1 s right turns. Checkpoints sit after each leg. */
function squarePlan(): { legs: Leg[]; end: number } {
  const legs: Leg[] = [];
  let start = 0;
  for (let i = 0; i < 4; i++) {
    const steps = [0, 1, 2, 3].map((k) => start + 500 + k * 500);
    const checkT = steps[3]! + 200;
    const turnStart = i < 3 ? checkT + 200 : Number.POSITIVE_INFINITY;
    const turnEnd = i < 3 ? turnStart + 1000 : turnStart;
    legs.push({ heading: CARDINALS[i]!, steps, checkT, turnStart, turnEnd });
    start = i < 3 ? turnEnd + 400 : checkT;
  }
  return { legs, end: start };
}

function headingDegAt(t: number, legs: readonly Leg[]): number {
  for (const leg of legs) {
    if (t <= leg.turnStart) return leg.heading;
    if (t < leg.turnEnd) {
      const u = (t - leg.turnStart) / (leg.turnEnd - leg.turnStart);
      return leg.heading + 90 * u;
    }
  }
  return legs[legs.length - 1]!.heading;
}

function yawRateAt(t: number, legs: readonly Leg[]): number {
  for (const leg of legs) {
    if (t >= leg.turnStart && t < leg.turnEnd) return Math.PI / 2;
  }
  return 0;
}

/** World-down in the device frame after pitch θ. Heading does not change it. */
function downDevice(pitchRad: number): Vec3 {
  return { x: 0, y: -Math.sin(pitchRad), z: -Math.cos(pitchRad) };
}

/** Device gyro for a clockwise heading rate at a fixed pitch. */
function deviceGyro(pitchRad: number, yawRate: number): Vec3 {
  return {
    x: 0,
    y: -yawRate * Math.sin(pitchRad),
    z: -yawRate * Math.cos(pitchRad),
  };
}

/** Earth field in the device frame at pitch θ and heading ψ. */
function deviceMag(pitchRad: number, headingRad: number): Vec3 {
  const sp = Math.sin(pitchRad);
  const cp = Math.cos(pitchRad);
  const sh = Math.sin(headingRad);
  const ch = Math.cos(headingRad);
  return {
    x: -BN * sh,
    y: BN * ch * cp - BD * sp,
    z: -BN * ch * sp - BD * cp,
  };
}

function squareSequence(pitchDeg: number, atRest: AccelAtRest): DeviceSample[] {
  const { legs, end } = squarePlan();
  const pitch = pitchDeg * DEG;
  const down = downDevice(pitch);
  const sign = atRest === 'up' ? -1 : 1;
  const samples: DeviceSample[] = [];
  for (let t = 0; t <= end; t += DT_MS) {
    let bump = 0;
    for (const leg of legs) {
      for (const center of leg.steps) bump += hann(t, center, STEP_AMP, STEP_HALF_MS);
    }
    const scale = sign * (1 + bump / G);
    const heading = headingDegAt(t, legs);
    const gyro = deviceGyro(pitch, yawRateAt(t, legs));
    const mag = deviceMag(pitch, heading * DEG);
    const mark = legs.findIndex((leg) => leg.checkT === t);
    samples.push({
      t,
      accel: {
        x: down.x * scale,
        y: down.y * scale,
        z: down.z * scale,
        timestamp: t / 1000,
      },
      gyro: { x: gyro.x, y: gyro.y, z: gyro.z, timestamp: t / 1000 },
      mag: { x: mag.x, y: mag.y, z: mag.z, timestamp: t / 1000 },
      mark: mark === -1 ? null : mark,
    });
  }
  return samples;
}

type FakeSensor = MotionSensor & {
  emit: (measurement: SensorMeasurement) => void;
};

function fakeSensor(): FakeSensor {
  let listener: ((measurement: SensorMeasurement) => void) | null = null;
  return {
    addListener: jest.fn((fn: (measurement: SensorMeasurement) => void) => {
      listener = fn;
      return { remove: jest.fn(() => (listener = null)) };
    }),
    setUpdateInterval: jest.fn(),
    isAvailableAsync: jest.fn(async () => true),
    requestPermissionsAsync: jest.fn(async () => ({ granted: true })),
    emit(measurement) {
      listener?.(measurement);
    },
  };
}

function motionSensors() {
  return {
    Accelerometer: fakeSensor(),
    Gyroscope: fakeSensor(),
    Magnetometer: fakeSensor(),
  };
}

function readSquare(
  engine: LiveFloorwalkerEngine,
  headings: number[],
  legEnds: { x: number; y: number }[],
): SquareResult {
  const snapshot = engine.getSnapshot();
  const final = snapshot.rawPath[snapshot.rawPath.length - 1]!;
  return {
    steps: snapshot.stepCount,
    headings,
    legEnds,
    final: { x: final.x, y: final.y },
    errorM: Math.hypot(final.x, final.y),
  };
}

/**
 * Master's sensor feed, before leveling: accel relabel, yaw = −device.z,
 * mag axes copied straight across. Kept here so the square reports the
 * upright error of that mapping next to the leveled feed.
 */
function pushLegacy(engine: LiveFloorwalkerEngine, sample: DeviceSample): void {
  const { accel, gyro, mag, t } = sample;
  engine.pushAccel({
    t,
    x: accel.y * G,
    y: accel.x * G,
    z: -accel.z * G,
  });
  engine.pushGyro({ t, yawRate: -gyro.z });
  engine.pushMag({ t, x: mag.y, y: mag.x, z: -mag.z });
}

function engineForSquare(): LiveFloorwalkerEngine {
  return createLiveEngine({ stepLengthM: 1, drift: { corridor: false } });
}

function runLegacy(pitchDeg: number): SquareResult {
  const engine = engineForSquare();
  const headings: number[] = [];
  const legEnds: { x: number; y: number }[] = [];
  for (const sample of squareSequence(pitchDeg, 'down')) {
    pushLegacy(engine, sample);
    if (sample.mark === null) continue;
    const snapshot = engine.getSnapshot();
    const end = snapshot.rawPath[snapshot.rawPath.length - 1]!;
    headings.push(snapshot.heading);
    legEnds.push({ x: end.x, y: end.y });
  }
  return readSquare(engine, headings, legEnds);
}

async function runFeed(pitchDeg: number, atRest: AccelAtRest): Promise<SquareResult> {
  const sensors = motionSensors();
  const engine = engineForSquare();
  await engine.startSensors({ sensors, accelAtRest: atRest });
  const headings: number[] = [];
  const legEnds: { x: number; y: number }[] = [];
  for (const sample of squareSequence(pitchDeg, atRest)) {
    sensors.Accelerometer.emit(sample.accel);
    sensors.Gyroscope.emit(sample.gyro);
    sensors.Magnetometer.emit(sample.mag);
    if (sample.mark === null) continue;
    const snapshot = engine.getSnapshot();
    const end = snapshot.rawPath[snapshot.rawPath.length - 1]!;
    headings.push(snapshot.heading);
    legEnds.push({ x: end.x, y: end.y });
  }
  const result = readSquare(engine, headings, legEnds);
  engine.stopSensors();
  return result;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function report(label: string, result: SquareResult): string {
  return JSON.stringify({
    label,
    steps: result.steps,
    headings: result.headings.map(round4),
    legEnds: result.legEnds.map((point) => ({ x: round4(point.x), y: round4(point.y) })),
    final: { x: round4(result.final.x), y: round4(result.final.y) },
    errorM: round4(result.errorM),
  });
}

function angularError(actual: number, expected: number): number {
  const wrapped = Math.abs(((((actual - expected) % 360) + 540) % 360) - 180);
  return wrapped;
}

describe('level attitude math', () => {
  test('yaw about world-down stays clockwise at 0°, 45°, 65°, and 90° of pitch', () => {
    const rate = Math.PI / 2;
    for (const pitchDeg of [0, 45, 65, 90]) {
      const pitch = pitchDeg * DEG;
      const gyro = deviceGyro(pitch, rate);
      expect(yawAboutDown(gyro, downDevice(pitch))).toBeCloseTo(rate, 10);
    }
    const flat = deviceGyro(0, rate);
    expect(yawAboutDown(flat, downDevice(0))).toBeCloseTo(-flat.z, 12);
  });

  test('tilt-compensated mag recovers heading; straight up has no forward axis', () => {
    for (const pitchDeg of [0, 45, 65]) {
      for (const heading of CARDINALS) {
        const leveled = levelMagnetometer(
          deviceMag(pitchDeg * DEG, heading * DEG),
          downDevice(pitchDeg * DEG),
        );
        expect(leveled).not.toBeNull();
        expect(magneticHeadingDeg(leveled!.x, leveled!.y)).toBeCloseTo(
          heading === 0 ? 0 : heading,
          8,
        );
        expect(Math.hypot(leveled!.x, leveled!.y, leveled!.z)).toBeCloseTo(50, 8);
      }
    }
    expect(levelMagnetometer(deviceMag(90 * DEG, 0), downDevice(90 * DEG))).toBeNull();
  });

  test('tracking stays on up to 70° of pitch and pauses past it', () => {
    const at = (pitchDeg: number) => downDevice(pitchDeg * DEG);
    expect(LEVEL_MAX_TILT_FROM_HORIZONTAL_DEG).toBe(70);
    expect(tiltFromHorizontalDeg(at(0))).toBeCloseTo(0, 10);
    expect(tiltFromHorizontalDeg(at(70))).toBeCloseTo(70, 10);
    expect(attitudeIsLevel(at(70), at(70))).toBe(true);
    expect(attitudeIsLevel(at(70.1), at(70.1))).toBe(false);
    expect(attitudeIsLevel(at(0), at(80))).toBe(false);
    expect(attitudeIsLevel(at(65), at(65))).toBe(true);

    const androidFlat = worldDown({ x: 0, y: 0, z: 1 }, 'up');
    const iosFlat = worldDown({ x: 0, y: 0, z: -1 }, 'down');
    expect(androidFlat).not.toBeNull();
    expect(iosFlat).not.toBeNull();
    expect(androidFlat!.x).toBeCloseTo(iosFlat!.x, 12);
    expect(androidFlat!.y).toBeCloseTo(iosFlat!.y, 12);
    expect(androidFlat!.z).toBeCloseTo(-1, 12);
    expect(iosFlat!.z).toBeCloseTo(-1, 12);
  });
});

/**
 * Headings and closing error of the pre-leveling feed.
 * On a tilted leg the compass is stable and wrong, so fusion tracks it.
 */
const MASTER_SQUARE: Record<number, { headings: number[]; errorM: number }> = {
  0: { headings: [0, 90, 180, 270], errorM: 0 },
  45: { headings: [180, 141.7762, 180.8448, 228.0267], errorM: 14.1645 },
  65: { headings: [180, 145.8821, 177.2217, 217.2856], errorM: 14.7914 },
};

function expectHeadings(actual: readonly number[], expected: readonly number[]): void {
  expect(actual).toHaveLength(expected.length);
  for (let i = 0; i < expected.length; i++) {
    expect(actual[i]!).toBeCloseTo(expected[i]!, 4);
  }
}

describe('square walk through the sensor feed', () => {
  test('flat, 45°, and upright 65° close the square; the flat master mapping does not regress', async () => {
    const poses = [
      { label: 'flat-0', pitch: 0 },
      { label: 'tilt-45', pitch: 45 },
      { label: 'upright-65', pitch: 65 },
    ];
    const lines: string[] = [];
    for (const pose of poses) {
      const legacy = runLegacy(pose.pitch);
      const feed = await runFeed(pose.pitch, 'down');
      const master = MASTER_SQUARE[pose.pitch]!;
      lines.push(report(`${pose.label} master`, legacy));
      lines.push(report(`${pose.label} leveled`, feed));

      expect(legacy.steps).toBe(16);
      expectHeadings(legacy.headings, master.headings);
      expect(legacy.errorM).toBeCloseTo(master.errorM, 4);

      expect(feed.steps).toBe(16);
      expectHeadings(feed.headings, CARDINALS);
      expect(feed.errorM).toBeCloseTo(0, 4);
      expect(feed.legEnds[0]!.x).toBeCloseTo(0, 4);
      expect(feed.legEnds[0]!.y).toBeCloseTo(4, 4);
      expect(feed.legEnds[1]!.x).toBeCloseTo(4, 4);
      expect(feed.legEnds[1]!.y).toBeCloseTo(4, 4);
      expect(feed.legEnds[2]!.x).toBeCloseTo(4, 4);
      expect(feed.legEnds[2]!.y).toBeCloseTo(0, 4);
      expect(feed.legEnds[3]!.x).toBeCloseTo(0, 4);
      expect(feed.legEnds[3]!.y).toBeCloseTo(0, 4);
    }

    const android = await runFeed(65, 'up');
    lines.push(report('upright-65 android-up', android));
    expectHeadings(android.headings, CARDINALS);
    expect(android.errorM).toBeCloseTo(0, 4);

    // Printed by the test run. The assertions above lock the same figures.
    console.log(lines.join('\n'));
  });
});

describe('tilt gate', () => {
  test('tracking pauses past 70° of pitch and resumes once the phone is level again', async () => {
    const sensors = motionSensors();
    const engine = engineForSquare();
    await engine.startSensors({ sensors, accelAtRest: 'down' });

    const emit = (
      t: number,
      pitchDeg: number,
      bump: number,
      yawRate: number,
      headingDeg: number,
    ) => {
      const pitch = pitchDeg * DEG;
      const down = downDevice(pitch);
      const scale = 1 + bump / G;
      const gyro = deviceGyro(pitch, yawRate);
      const mag = deviceMag(pitch, headingDeg * DEG);
      sensors.Accelerometer.emit({
        x: down.x * scale,
        y: down.y * scale,
        z: down.z * scale,
        timestamp: t / 1000,
      });
      sensors.Gyroscope.emit({ ...gyro, timestamp: t / 1000 });
      sensors.Magnetometer.emit({ ...mag, timestamp: t / 1000 });
    };

    const play = (
      from: number,
      to: number,
      pitchDeg: number,
      bumpAt: (t: number) => number,
      yawAt: (t: number) => number,
      headingAt: (t: number) => number,
    ) => {
      for (let t = from; t <= to; t += DT_MS) {
        emit(t, pitchDeg, bumpAt(t), yawAt(t), headingAt(t));
      }
    };

    const stepsAt = (centers: readonly number[]) => (t: number) => {
      let bump = 0;
      for (const center of centers) bump += hann(t, center, STEP_AMP, STEP_HALF_MS);
      return bump;
    };
    const still = () => 0;

    play(0, 2200, 0, stepsAt([500, 1000, 1500]), still, () => 0);
    const walking = engine.getSnapshot();
    expect(walking.stepCount).toBe(3);
    expect(walking.heading).toBeCloseTo(0, 5);

    // 80° is past the gate. Four steps and a 90°/s turn must not register.
    const steepHeading = (t: number) => (t < 4800 ? 0 : t >= 5800 ? 90 : ((t - 4800) / 1000) * 90);
    const steepYaw = (t: number) => (t >= 4800 && t < 5800 ? Math.PI / 2 : 0);
    play(2220, 6200, 80, stepsAt([3000, 3500, 4000, 4500]), steepYaw, steepHeading);
    const paused = engine.getSnapshot();
    expect(paused.stepCount).toBe(walking.stepCount);
    expect(paused.heading).toBeCloseTo(walking.heading, 5);
    expect(paused.rawPath).toHaveLength(walking.rawPath.length);

    // Back to flat, now actually facing east. Hold still while gravity settles.
    play(6220, 9000, 0, still, still, () => 90);
    const settled = engine.getSnapshot();

    play(9020, 11000, 0, stepsAt([9500, 10000, 10500]), still, () => 90);
    const resumed = engine.getSnapshot();
    expect(resumed.stepCount).toBe(settled.stepCount + 3);

    const turnHeading = (t: number) =>
      t < 11200 ? 90 : t >= 12200 ? 180 : 90 + ((t - 11200) / 1000) * 90;
    const turnYaw = (t: number) => (t >= 11200 && t < 12200 ? Math.PI / 2 : 0);
    play(11020, 12800, 0, still, turnYaw, turnHeading);
    const turned = engine.getSnapshot();
    expect(angularError(turned.heading, resumed.heading)).toBeGreaterThan(80);
    expect(angularError(turned.heading, resumed.heading)).toBeLessThan(100);

    console.log(
      JSON.stringify({
        label: 'gate',
        beforeSteps: walking.stepCount,
        beforeHeading: round4(walking.heading),
        pausedSteps: paused.stepCount,
        pausedHeading: round4(paused.heading),
        resumedSteps: resumed.stepCount,
        resumedHeading: round4(resumed.heading),
        turnedHeading: round4(turned.heading),
      }),
    );
    engine.stopSensors();
  });
});
