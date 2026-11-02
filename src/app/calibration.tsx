import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { createHallwayCalibration } from '@/calibration/hallway';
import {
  CALIBRATION_STEPS,
  beginCalibration,
  cancelCalibration,
  leaveCalibration,
  parseCourseMeters,
  stepsTowardCalibration,
  type CalibrationSession,
} from '@/calibration/session';
import { Button } from '@/components/button';
import { Glass } from '@/components/glass';
import { Icon } from '@/components/icon';
import { Screen } from '@/components/screen';
import { StepRing } from '@/components/step-ring';
import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing, withAlpha } from '@/constants/theme';
import { isCalibrated, readStepLength } from '@/db/calibration';
import { ensureDatabase } from '@/db/database';
import { createLiveEngine, getEngine, type LiveFloorwalkerEngine } from '@/engine';
import { useTheme } from '@/hooks/use-theme';
import { sensorStartFaultMessage } from '@/sensor-start';

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
  const [stepLengthM, setStepLengthM] = useState<number | null>(
    () => readStepLength()?.stepLengthM ?? null,
  );
  const sessionRef = useRef(session);
  const distanceTextRef = useRef(distanceText);
  const startRef = useRef<() => void>(() => undefined);
  const endRef = useRef<() => void>(() => undefined);
  const cancelRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    let cancelled = false;
    void ensureDatabase().then(() => {
      if (cancelled) return;
      const next = initialSession();
      sessionRef.current = next;
      setSession(next);
      setStepLengthM(readStepLength()?.stepLengthM ?? null);
      setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useFocusEffect(
    useCallback(() => {
      const live = getEngine();
      let calibration: LiveFloorwalkerEngine | null = null;
      let timer: ReturnType<typeof setInterval> | undefined;
      let walking = false;
      let disposed = false;

      const halt = () => {
        const started = walking;
        walking = false;
        if (timer !== undefined) {
          clearInterval(timer);
          timer = undefined;
        }
        if (started) calibration?.stopSensors();
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
        const engine = createLiveEngine();
        calibration = engine;
        setCourseMeters(distanceM);
        setStatus('');
        const baseline = engine.getSnapshot().stepCount;
        const run = createHallwayCalibration({
          courseMeters: distanceM,
          measure: (course, steps) => engine.calibrateStepLength(course, steps),
          live,
        });
        const progress = () => stepsTowardCalibration(baseline, engine.getSnapshot().stepCount);
        walking = true;
        sessionRef.current = next;
        setSession(next);
        void engine.startSensors().then((started) => {
          if (disposed || !walking) return;
          const message = sensorStartFaultMessage(started);
          if (message === null) return;
          const idle = cancelCalibration(sessionRef.current);
          sessionRef.current = idle;
          halt();
          setSession(idle);
          setStatus(message);
        });

        const tick = () => {
          if (!walking) return;
          const progressed = run.poll(sessionRef.current, progress());
          if (!walking) return;
          sessionRef.current = progressed;
          setSession(progressed);
          if (progressed.steps >= CALIBRATION_STEPS) setStatus('');
        };

        endRef.current = () => {
          if (!walking) return;
          const result = run.end(sessionRef.current, progress());
          if (result.session.phase !== 'walking') halt();
          sessionRef.current = result.session;
          setSession(result.session);
          setStatus(result.status);
          if (result.saved) setStepLengthM(result.saved.stepLengthM);
          else if (result.session.phase === 'idle') {
            setStepLengthM(readStepLength()?.stepLengthM ?? null);
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
        setStatus('');
      };

      return () => {
        disposed = true;
        const next = leaveCalibration(sessionRef.current);
        sessionRef.current = next;
        halt();
        startRef.current = () => undefined;
        endRef.current = () => undefined;
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
            value={`${session.steps}`}
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
            <Glass style={styles.message}>
              <ThemedText type="title2">Keep walking straight</ThemedText>
              <ThemedText themeColor="textSecondary" style={styles.center}>
                {remaining > 0
                  ? `${remaining} more ${remaining === 1 ? 'step' : 'steps'} before you can finish`
                  : 'Mark the end when you reach it'}
                {courseMeters !== null ? ` · ${courseMeters} m hallway` : ''}
              </ThemedText>
            </Glass>
            <View style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
              <ThemedText type="footnote" themeColor="textSecondary">
                Walk at your normal pace with the phone held in front of you. Mark the end of the
                hallway when you get there. At least {CALIBRATION_STEPS} steps.
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
        <>
          <Button
            label="I'm at the end of the hallway"
            variant="primary"
            onPress={() => endRef.current()}
          />
          <Button label="Cancel" variant="glass" onPress={() => cancelRef.current()} />
        </>
      ) : null}
    </Screen>
  );
}

const HOW_IT_WORKS = [
  ['Find a straight hallway', 'Clear of furniture, at least 5 m long'],
  ['Measure and enter its length', 'A tape measure or floor tiles work'],
  ['Walk it, then mark the end', `At least ${CALIBRATION_STEPS} steps at your normal pace`],
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
    alignSelf: 'center',
    alignItems: 'center',
    maxWidth: '100%',
    gap: Spacing.one + Spacing.half,
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: Radius.large,
  },
  center: {
    textAlign: 'center',
  },
});
