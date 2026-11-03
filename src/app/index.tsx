import { useFocusEffect } from 'expo-router';
import { type ReactNode, useCallback, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button, IconButton } from '@/components/button';
import { Glass } from '@/components/glass';
import { GridBackground } from '@/components/grid-background';
import { Screen } from '@/components/screen';
import SkiaWalk from '@/components/skia-walk';
import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { getActiveFloor, resumeLiveWalk, type ActiveFloor } from '@/db/session';
import {
  getEngine,
  mockEngine,
  type EngineSnapshot,
  type LiveFloorwalkerEngine,
  type SensorStartFault,
} from '@/engine';
import { lightHaptic } from '@/haptics';
import { useTheme } from '@/hooks/use-theme';
import { walkPill } from '@/sensor-start';
import {
  assertBackAtStart,
  releaseBackAtStart,
  showBackAtStart,
  type LoopHold,
} from '@/walk/close-loop';
import { createWalkPoll } from '@/walk/live-poll';
import {
  commitWalkPins,
  dropLandmark,
  emptyLandmark,
  newLandmark,
  readWalk,
  type HeldPin,
  type OpenLandmark,
  type WalkPinRead,
} from '@/walk/pin-drop';
import { startWalkSensors } from '@/walk/sensors';
import { formatHeading, headingIsGyroOnly, walkReadout } from '@/walk/stats';

/** Re-read the engine often enough to track a step as it lands. */
const POLL_MS = 50;

export default function WalkScreen() {
  const theme = useTheme();
  const [snapshot, setSnapshot] = useState<EngineSnapshot>(() => getEngine().getSnapshot());
  const [active, setActive] = useState<ActiveFloor | null>(() => getActiveFloor());
  const [follow, setFollow] = useState(false);
  const stepsRef = useRef(snapshot.stepCount);
  const landmarkRef = useRef<OpenLandmark>(emptyLandmark());
  const heldRef = useRef<HeldPin[]>([]);
  const loopHold = useRef<LoopHold | null>(null);
  const startLiveWalk = useRef<(() => void) | null>(null);

  const applyPinRead = useCallback((engine: LiveFloorwalkerEngine, result: WalkPinRead) => {
    commitWalkPins(engine, result);
    heldRef.current = result.held;
    setSnapshot(result.shown);
  }, []);

  useFocusEffect(
    useCallback(() => {
      const poll = createWalkPoll();
      let stopped = false;

      const read = () => {
        let frame = poll(heldRef.current);
        const released = releaseBackAtStart(frame.engine, loopHold.current, frame.view.shown);
        loopHold.current = released.hold;
        if (released.readAgain) frame = poll(heldRef.current);
        const next = frame.view.shown;
        if (next.stepCount > stepsRef.current) lightHaptic();
        stepsRef.current = next.stepCount;
        setActive(getActiveFloor());
        applyPinRead(frame.engine, frame.view);
      };

      read();
      const timer = setInterval(read, POLL_MS);
      const engine = poll(heldRef.current).engine;
      startLiveWalk.current = () => {
        void startWalkSensors(engine, getActiveFloor(), () => !stopped, read);
      };
      startLiveWalk.current();
      return () => {
        stopped = true;
        startLiveWalk.current = null;
        clearInterval(timer);
        engine.stopSensors();
      };
    }, [applyPinRead]),
  );

  const backAtStart = () => {
    const engine = getEngine();
    const hold = assertBackAtStart(engine, engine.getSnapshot());
    if (!hold) return;
    loopHold.current = hold;
    applyPinRead(
      engine,
      readWalk(
        engine.getSnapshot(),
        mockEngine.getSnapshot(),
        engine.isRecalled(),
        heldRef.current,
      ),
    );
  };

  const dropPin = () => {
    const engine = getEngine();
    const result = dropLandmark(
      landmarkRef.current,
      engine.getSnapshot(),
      mockEngine.getSnapshot(),
      engine.isRecalled(),
      heldRef.current,
    );
    if (!result.placed) return;
    landmarkRef.current = result.open;
    applyPinRead(engine, result.read);
  };

  const newPin = () => {
    landmarkRef.current = newLandmark(landmarkRef.current);
  };

  const heading = Number.isFinite(snapshot.heading) ? snapshot.heading : 0;
  const readout = walkReadout(snapshot);

  const resume = () => {
    resumeLiveWalk();
    setActive(null);
    const engine = getEngine();
    applyPinRead(
      engine,
      readWalk(engine.getSnapshot(), mockEngine.getSnapshot(), false, heldRef.current),
    );
    startLiveWalk.current?.();
  };

  return (
    <Screen
      title="Walk"
      subtitle={active ? `${active.buildingName} · ${active.name}` : 'Live walk'}
      headerRight={
        <StatusPill
          savedFloor={active !== null}
          fault={snapshot.sensorStartFailed}
          pitchPaused={snapshot.pitchPaused}
        />
      }
      background={<GridBackground />}
    >
      <Glass style={styles.readout}>
        <Metric label="Steps" value={String(readout.stepCount)} live />
        <View style={[styles.divider, { backgroundColor: theme.glassBorder }]} />
        <Metric label="Distance" value={readout.distance} />
        <View style={[styles.divider, { backgroundColor: theme.glassBorder }]} />
        <Metric
          label="Heading"
          value={formatHeading(heading)}
          dim={headingIsGyroOnly(snapshot.gyroOnly)}
        />
      </Glass>
      <Glass style={styles.legend}>
        <LegendItem label="Raw">
          <View style={[styles.line, { height: 2, backgroundColor: theme.pathRaw }]} />
        </LegendItem>
        <LegendItem label="Corrected">
          <View style={[styles.line, { backgroundColor: theme.pathCorrected }]} />
        </LegendItem>
        <LegendItem label="Pin">
          <View style={[styles.dot, { backgroundColor: theme.accent }]} />
        </LegendItem>
      </Glass>
      <SkiaWalk snapshot={snapshot} follow={follow} />
      {active || !showBackAtStart(snapshot) ? null : (
        <Button
          label="Back at start"
          variant="glass"
          accessibilityHint="Pulls the end of this walk back to the start"
          onPress={backAtStart}
        />
      )}
      <View style={styles.actions}>
        {active ? (
          <Button
            label="Resume live walk"
            variant="primary"
            icon="walk"
            onPress={resume}
            style={styles.primary}
          />
        ) : (
          <>
            <Button
              label="New pin"
              variant="glass"
              compact
              accessibilityHint="The next drop starts a new landmark"
              onPress={newPin}
            />
            <Button
              label="Drop pin"
              variant="primary"
              icon="pin"
              onPress={dropPin}
              style={styles.primary}
            />
          </>
        )}
        <IconButton
          icon="locate"
          label={follow ? 'Show whole walk' : 'Follow me'}
          accessibilityHint="Zooms to the area around where you are"
          accessibilityState={{ selected: follow }}
          size={54}
          color={follow ? theme.accent : theme.text}
          onPress={() => setFollow((on) => !on)}
        />
      </View>
    </Screen>
  );
}

function StatusPill({
  savedFloor,
  fault,
  pitchPaused,
}: {
  savedFloor: boolean;
  fault: SensorStartFault | undefined;
  pitchPaused: boolean;
}) {
  const theme = useTheme();
  const pill = walkPill(savedFloor, fault, pitchPaused);
  return (
    <Glass style={styles.pill}>
      <View
        style={[styles.dot, { backgroundColor: pill.live ? theme.success : theme.textSecondary }]}
      />
      <ThemedText type="smallBold">{pill.label}</ThemedText>
    </Glass>
  );
}

/** "45.8 m" shows as a large 45.8 with a small m; "60° NE" as 60° with NE. */
function Metric({
  label,
  value,
  live,
  dim,
}: {
  label: string;
  value: string;
  live?: boolean;
  dim?: boolean;
}) {
  const split = value.lastIndexOf(' ');
  const number = split > 0 ? value.slice(0, split) : value;
  const unit = split > 0 ? value.slice(split + 1) : '';
  return (
    <View style={styles.metric} accessible accessibilityLabel={`${label} ${value}`}>
      <ThemedText type="caption" themeColor="textSecondary">
        {label}
      </ThemedText>
      <ThemedText
        type="metric"
        themeColor={dim ? 'textSecondary' : 'text'}
        numberOfLines={1}
        accessibilityLiveRegion={live ? 'polite' : undefined}
      >
        {number}
        {unit ? (
          <ThemedText type="headline" themeColor="textSecondary">
            {` ${unit}`}
          </ThemedText>
        ) : null}
      </ThemedText>
    </View>
  );
}

function LegendItem({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={styles.legendItem}>
      {children}
      <ThemedText type="footnote" themeColor="textSecondary">
        {label}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three - Spacing.one,
  },
  primary: {
    flex: 1,
  },
  readout: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.four,
    borderRadius: Radius.card,
  },
  metric: {
    flex: 1,
    gap: Spacing.half,
  },
  divider: {
    width: StyleSheet.hairlineWidth * 2,
    alignSelf: 'stretch',
  },
  legend: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderRadius: Radius.large,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one + Spacing.half,
  },
  line: {
    width: 16,
    height: 4,
    borderRadius: 2,
  },
  dot: {
    width: 9,
    height: 9,
    borderRadius: 5,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderRadius: Radius.large,
  },
});
