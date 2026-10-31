import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, TextInput } from 'react-native';

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
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
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

  if (!ready) {
    return (
      <Screen title="Calibration">
        <ThemedText>Walk 10 steps in a straight line.</ThemedText>
      </Screen>
    );
  }

  return (
    <Screen title="Calibration">
      {session.phase === 'done' ? (
        <ThemedText>
          {stepLengthM === null ? 'done' : `done · ${stepLengthM.toFixed(2)} m/step`}
        </ThemedText>
      ) : (
        <ThemedText>Walk 10 steps in a straight line.</ThemedText>
      )}
      {session.phase === 'idle' ? (
        <TextInput
          value={distanceText}
          onChangeText={(text) => {
            distanceTextRef.current = text;
            setDistanceText(text);
          }}
          placeholder="Hallway length (m)"
          placeholderTextColor={theme.textSecondary}
          accessibilityLabel="Hallway length in meters"
          keyboardType="decimal-pad"
          inputMode="decimal"
          style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
        />
      ) : null}
      {session.phase === 'walking' && courseMeters !== null ? (
        <ThemedText type="small">{courseMeters} m</ThemedText>
      ) : null}
      {status ? <ThemedText type="small">{status}</ThemedText> : null}
      {session.phase === 'idle' ? null : (
        <ThemedText>
          {session.steps}/{CALIBRATION_STEPS}
        </ThemedText>
      )}
      {session.phase === 'idle' ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => startRef.current()}
          style={[styles.button, { backgroundColor: theme.backgroundElement }]}
        >
          <ThemedText>start</ThemedText>
        </Pressable>
      ) : null}
      {session.phase === 'walking' ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => cancelRef.current()}
          style={[styles.button, { backgroundColor: theme.backgroundElement }]}
        >
          <ThemedText>cancel</ThemedText>
        </Pressable>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  input: {
    fontSize: 16,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
  },
  button: {
    alignItems: 'center',
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.four,
  },
});
