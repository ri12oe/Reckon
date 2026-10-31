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
import { getEngine, mockEngine, type EngineSnapshot, type LiveFloorwalkerEngine } from '@/engine';
import { lightHaptic } from '@/haptics';
import { useTheme } from '@/hooks/use-theme';
import { dropWalkPin, readWalk, type HeldPin, type WalkPinRead } from '@/walk/pin-drop';
import { formatDistance, formatHeading, pathLength } from '@/walk/stats';

/** Re-read the engine often enough to track a step as it lands. */
const POLL_MS = 50;

export default function WalkScreen() {
  const theme = useTheme();
  const [snapshot, setSnapshot] = useState<EngineSnapshot>(() => getEngine().getSnapshot());
  const [active, setActive] = useState<ActiveFloor | null>(() => getActiveFloor());
  const [follow, setFollow] = useState(false);
  const stepsRef = useRef(snapshot.stepCount);
  const droppedRef = useRef(0);
  const heldRef = useRef<HeldPin[]>([]);

  const applyPinRead = useCallback((engine: LiveFloorwalkerEngine, result: WalkPinRead) => {
    for (const pin of result.commit) engine.addPin(pin);
    heldRef.current = result.held;
    setSnapshot(result.shown);
  }, []);

  useFocusEffect(
    useCallback(() => {
      const engine = getEngine();
      void engine.startSensors().catch(() => undefined);

      const read = () => {
        const next = engine.getSnapshot();
        if (next.stepCount > stepsRef.current) lightHaptic();
        stepsRef.current = next.stepCount;
        setActive(getActiveFloor());
        applyPinRead(
          engine,
          readWalk(next, mockEngine.getSnapshot(), engine.isRecalled(), heldRef.current),
        );
      };

      read();
      const timer = setInterval(read, POLL_MS);
      return () => {
        clearInterval(timer);
        engine.stopSensors();
      };
    }, [applyPinRead]),
  );

  const dropPin = () => {
    const engine = getEngine();
    const n = droppedRef.current + 1;
    const result = dropWalkPin(
      engine.getSnapshot(),
      mockEngine.getSnapshot(),
      engine.isRecalled(),
      heldRef.current,
      { id: `pin-${n}`, label: `Pin ${n}` },
    );
    const placed = result.commit.length > 0 || result.held.length > heldRef.current.length;
    if (!placed) return;
    droppedRef.current = n;
    applyPinRead(engine, result);
  };

  const heading = Number.isFinite(snapshot.heading) ? snapshot.heading : 0;

  const resume = () => {
    resumeLiveWalk();
    setActive(null);
    const engine = getEngine();
    applyPinRead(
      engine,
      readWalk(engine.getSnapshot(), mockEngine.getSnapshot(), false, heldRef.current),
    );
  };

  return (
    <Screen
      title="Walk"
      subtitle={active ? `${active.buildingName} · ${active.name}` : 'Live walk'}
      headerRight={<StatusPill live={!active} />}
      background={<GridBackground />}
    >
      <Glass style={styles.readout}>
        <Metric label="Steps" value={String(snapshot.stepCount)} live />
        <View style={[styles.divider, { backgroundColor: theme.glassBorder }]} />
        <Metric label="Distance" value={formatDistance(pathLength(snapshot.correctedPath))} />
        <View style={[styles.divider, { backgroundColor: theme.glassBorder }]} />
        <Metric label="Heading" value={formatHeading(heading)} />
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
          <Button
            label="Drop pin"
            variant="primary"
            icon="pin"
            onPress={dropPin}
            style={styles.primary}
          />
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

function StatusPill({ live }: { live: boolean }) {
  const theme = useTheme();
  return (
    <Glass style={styles.pill}>
      <View style={[styles.dot, { backgroundColor: live ? theme.success : theme.textSecondary }]} />
      <ThemedText type="smallBold">{live ? 'Live' : 'Saved floor'}</ThemedText>
    </Glass>
  );
}

/** "45.8 m" shows as a large 45.8 with a small m; "60° NE" as 60° with NE. */
function Metric({ label, value, live }: { label: string; value: string; live?: boolean }) {
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
