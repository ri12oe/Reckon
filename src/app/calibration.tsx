import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, ScrollView, StyleSheet, TextInput, View } from 'react-native';

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
import { Icon } from '@/components/icon';
import { Screen } from '@/components/screen';
import { StepRing } from '@/components/step-ring';
import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing, withAlpha } from '@/constants/theme';
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

  const subtitle = 'Teach Reckon your stride';

  if (!ready) {
    return <Screen title="Calibration" subtitle={subtitle} />;
  }

  const remaining = Math.max(CALIBRATION_STEPS - session.steps, 0);

  return (
    <Screen title="Calibration" subtitle={subtitle}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        {session.phase === 'done' ? (
          <StepRing
            total={CALIBRATION_STEPS}
            done={CALIBRATION_STEPS}
            value={stepLengthM === null ? '✓' : stepLengthM.toFixed(2)}
            caption={stepLengthM === null ? 'calibrated' : 'meters per step'}
          />
        ) : (
          <StepRing
            total={CALIBRATION_STEPS}
            done={session.steps}
            value={`${session.steps}/${CALIBRATION_STEPS}`}
            caption="steps"
          />
        )}

        {session.phase === 'idle' ? (
          <>
            <View style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
              {HOW_IT_WORKS.map(([title, detail], i) => (
                <View key={title} style={styles.stepRow}>
                  <View style={[styles.number, { backgroundColor: withAlpha(theme.accent, 0.18) }]}>
                    <ThemedText type="smallBold" style={{ color: theme.accent }}>
                      {i + 1}
                    </ThemedText>
                  </View>
                  <View style={styles.stepText}>
                    <ThemedText type="small">{title}</ThemedText>
                    <ThemedText type="footnote" themeColor="textSecondary">
                      {detail}
                    </ThemedText>
                  </View>
                </View>
              ))}
            </View>
            <View
              style={[
                styles.field,
                {
                  backgroundColor: theme.backgroundElement,
                  borderColor: status ? theme.danger : theme.accent,
                },
              ]}
            >
              <Icon name="ruler" color={theme.textSecondary} />
              <ThemedText themeColor="textSecondary" style={styles.fieldLabel}>
                Hallway length
              </ThemedText>
              <TextInput
                value={distanceText}
                onChangeText={(text) => {
                  distanceTextRef.current = text;
                  setDistanceText(text);
                }}
                placeholder="7.5"
                placeholderTextColor={theme.textTertiary}
                accessibilityLabel="Hallway length in meters"
                keyboardType="decimal-pad"
                inputMode="decimal"
                style={[styles.input, { color: theme.text }]}
              />
              <ThemedText themeColor="textSecondary">m</ThemedText>
            </View>
          </>
        ) : null}

        {session.phase === 'walking' ? (
          <>
            <View style={styles.message}>
              <ThemedText type="title2">Keep walking straight</ThemedText>
              <ThemedText themeColor="textSecondary" style={styles.center}>
                {remaining} more {remaining === 1 ? 'step' : 'steps'}
                {courseMeters !== null ? ` down the ${courseMeters} m hallway` : ''}
              </ThemedText>
            </View>
            <View style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
              <ThemedText type="footnote" themeColor="textSecondary">
                Walk at your normal pace with the phone held in front of you. Reckon stops at{' '}
                {CALIBRATION_STEPS} steps and saves your step length.
              </ThemedText>
            </View>
          </>
        ) : null}

        {session.phase === 'done' ? (
          <View style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
            <ThemedText type="smallBold" style={{ color: theme.success }}>
              Calibrated
            </ThemedText>
            <ThemedText type="footnote" themeColor="textSecondary">
              Your step length is saved and used on every walk.
            </ThemedText>
          </View>
        ) : null}

        {status ? (
          <ThemedText type="small" style={{ color: theme.danger }}>
            {status}
          </ThemedText>
        ) : null}
      </ScrollView>

      {session.phase === 'idle' ? (
        <Button label="Start calibration" variant="primary" onPress={() => startRef.current()} />
      ) : null}
      {session.phase === 'walking' ? (
        <Button label="Cancel" variant="glass" onPress={() => cancelRef.current()} />
      ) : null}
    </Screen>
  );
}

const HOW_IT_WORKS = [
  ['Find a straight hallway', 'Clear of furniture, at least 5 m long'],
  ['Measure and enter its length', 'A tape measure or floor tiles work'],
  ['Walk 10 normal steps', 'Hold the phone in front of you'],
] as const;

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
  },
  content: {
    gap: Spacing.three,
    paddingBottom: Spacing.three,
  },
  card: {
    gap: Spacing.three,
    padding: Spacing.three,
    borderRadius: Radius.card,
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  number: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepText: {
    flex: 1,
  },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    minHeight: 56,
    paddingHorizontal: Spacing.three,
    borderRadius: Radius.large - 4,
    borderWidth: 1.5,
  },
  fieldLabel: {
    flex: 1,
  },
  input: {
    width: 72,
    fontSize: 17,
    fontWeight: 600,
    textAlign: 'right',
    paddingVertical: Spacing.two,
  },
  message: {
    alignItems: 'center',
    gap: Spacing.one,
  },
  center: {
    textAlign: 'center',
  },
});
