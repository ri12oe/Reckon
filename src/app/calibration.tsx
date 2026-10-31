import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, TextInput, View } from 'react-native';

import {
  CALIBRATION_STEPS,
  beginCalibration,
  cancelCalibration,
  leaveCalibration,
  noteSteps,
  parseCourseMeters,
  stepsTowardCalibration,
  type CalibrationSession,
} from '@/calibration/session';
import { Button } from '@/components/button';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { isCalibrated, markCalibrated } from '@/db/calibration';
import { ensureDatabase } from '@/db/database';
import { getEngine } from '@/engine';
import { useTheme } from '@/hooks/use-theme';

/** Re-read the engine often enough to catch a step as it lands. */
const POLL_MS = 50;

function initialSession(): CalibrationSession {
  if (isCalibrated()) return { phase: 'done', steps: CALIBRATION_STEPS };
  return { phase: 'idle', steps: 0 };
}

export default function CalibrationScreen() {
  const theme = useTheme();
  const [ready, setReady] = useState(Platform.OS !== 'web');
  const [session, setSession] = useState<CalibrationSession>(initialSession);
  const [distanceText, setDistanceText] = useState('');
  const [courseMeters, setCourseMeters] = useState<number | null>(null);
  const [status, setStatus] = useState('');
  const [stepLengthM, setStepLengthM] = useState<number | null>(null);
  const sessionRef = useRef(session);
  const distanceTextRef = useRef(distanceText);
  const distanceRef = useRef<number | null>(null);
  const startRef = useRef<() => void>(() => undefined);
  const cancelRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    let cancelled = false;
    void ensureDatabase().then(() => {
      if (cancelled) return;
      const next = initialSession();
      sessionRef.current = next;
      setSession(next);
      setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useFocusEffect(
    useCallback(() => {
      const engine = getEngine();
      let timer: ReturnType<typeof setInterval> | undefined;
      let walking = false;

      const halt = () => {
        const started = walking;
        walking = false;
        if (timer !== undefined) {
          clearInterval(timer);
          timer = undefined;
        }
        if (started) engine.stopSensors();
      };

      startRef.current = () => {
        if (walking) return;
        const distanceM = parseCourseMeters(distanceTextRef.current);
        if (distanceM === null) {
          setStatus('Enter the hallway length in meters.');
          return;
        }
        const next = beginCalibration(sessionRef.current);
        if (next.phase !== 'walking') return;
        distanceRef.current = distanceM;
        setCourseMeters(distanceM);
        setStatus('');
        const baseline = engine.getSnapshot().stepCount;
        walking = true;
        sessionRef.current = next;
        setSession(next);
        void engine.startSensors().catch(() => undefined);

        const tick = () => {
          if (!walking) return;
          const progressed = noteSteps(
            sessionRef.current,
            stepsTowardCalibration(baseline, engine.getSnapshot().stepCount),
          );
          if (!walking) return;
          sessionRef.current = progressed;
          setSession(progressed);
          if (progressed.phase === 'done') {
            halt();
            const distanceM = distanceRef.current;
            const estimate =
              distanceM === null ? null : engine.calibrateStepLength(distanceM, progressed.steps);
            setStepLengthM(estimate?.stepLengthM ?? null);
            if (!estimate) setStatus('That distance did not update step length.');
            markCalibrated();
          }
        };

        tick();
        if (walking) timer = setInterval(tick, POLL_MS);
      };

      cancelRef.current = () => {
        const next = cancelCalibration(sessionRef.current);
        sessionRef.current = next;
        halt();
        setSession(next);
      };

      return () => {
        const next = leaveCalibration(sessionRef.current);
        sessionRef.current = next;
        halt();
        startRef.current = () => undefined;
        cancelRef.current = () => undefined;
        setSession(next);
      };
    }, []),
  );

  const intro = (
    <ThemedText themeColor="textSecondary">
      Mark a straight stretch of hallway and measure it. Enter its length, tap Start, then walk{' '}
      {CALIBRATION_STEPS} steps along it. Reckon uses this to learn your step length.
    </ThemedText>
  );

  if (!ready) {
    return <Screen title="Calibration">{intro}</Screen>;
  }

  const progress = Math.min(session.steps / CALIBRATION_STEPS, 1);

  return (
    <Screen title="Calibration">
      {session.phase === 'done' ? (
        <View style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
          <ThemedText type="smallBold" style={{ color: theme.accent }}>
            Calibrated
          </ThemedText>
          <ThemedText type="subtitle">
            {stepLengthM === null ? 'Done' : `${stepLengthM.toFixed(2)} m per step`}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Your step length is saved and used on every walk.
          </ThemedText>
        </View>
      ) : (
        intro
      )}
      {session.phase === 'idle' ? (
        <View style={styles.field}>
          <ThemedText type="smallBold">Hallway length (meters)</ThemedText>
          <TextInput
            value={distanceText}
            onChangeText={(text) => {
              distanceTextRef.current = text;
              setDistanceText(text);
            }}
            placeholder="e.g. 7.5"
            placeholderTextColor={theme.textSecondary}
            accessibilityLabel="Hallway length in meters"
            keyboardType="decimal-pad"
            inputMode="decimal"
            style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
          />
        </View>
      ) : null}
      {session.phase === 'walking' ? (
        <View style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
          <ThemedText type="small" themeColor="textSecondary">
            Walking {courseMeters !== null ? `${courseMeters} m` : ''}
          </ThemedText>
          <ThemedText type="title" accessibilityLiveRegion="polite">
            {session.steps} / {CALIBRATION_STEPS}
          </ThemedText>
          <View style={[styles.track, { backgroundColor: theme.backgroundSelected }]}>
            <View
              style={[styles.bar, { width: `${progress * 100}%`, backgroundColor: theme.accent }]}
            />
          </View>
        </View>
      ) : null}
      {status ? (
        <ThemedText type="small" style={{ color: theme.danger }}>
          {status}
        </ThemedText>
      ) : null}
      {session.phase === 'idle' ? (
        <Button label="Start" variant="primary" onPress={() => startRef.current()} />
      ) : null}
      {session.phase === 'walking' ? (
        <Button label="Cancel" onPress={() => cancelRef.current()} />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  field: {
    gap: Spacing.two,
  },
  input: {
    fontSize: 16,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    borderRadius: Radius.medium,
  },
  card: {
    gap: Spacing.two,
    padding: Spacing.three,
    borderRadius: Radius.medium,
  },
  track: {
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
  },
  bar: {
    height: '100%',
  },
});
