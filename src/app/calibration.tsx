import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { Pressable, StyleSheet } from 'react-native';

import {
  CALIBRATION_STEPS,
  beginCalibration,
  cancelCalibration,
  leaveCalibration,
  noteSteps,
  stepsTowardCalibration,
  type CalibrationSession,
} from '@/calibration/session';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { isCalibrated, markCalibrated } from '@/db/calibration';
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
  const [session, setSession] = useState<CalibrationSession>(initialSession);
  const sessionRef = useRef(session);
  const startRef = useRef<() => void>(() => undefined);
  const cancelRef = useRef<() => void>(() => undefined);

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
        const next = beginCalibration(sessionRef.current);
        if (next.phase !== 'walking') return;
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

  return (
    <Screen title="Calibration">
      {session.phase === 'done' ? (
        <ThemedText>done</ThemedText>
      ) : (
        <ThemedText>Walk 10 steps in a straight line.</ThemedText>
      )}
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
  button: {
    alignItems: 'center',
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.four,
  },
});
