import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { Screen } from '@/components/screen';
import SkiaWalk from '@/components/skia-walk';
import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { getActiveFloor, resumeLiveWalk, type ActiveFloor } from '@/db/session';
import { getEngine, mockEngine, type EngineSnapshot, type LiveFloorwalkerEngine } from '@/engine';
import { lightHaptic } from '@/haptics';
import { useTheme } from '@/hooks/use-theme';
import { dropWalkPin, readWalk, type HeldPin, type WalkPinRead } from '@/walk/pin-drop';

/** Re-read the engine often enough to track a step as it lands. */
const POLL_MS = 50;

export default function WalkScreen() {
  const theme = useTheme();
  const [snapshot, setSnapshot] = useState<EngineSnapshot>(() => getEngine().getSnapshot());
  const [active, setActive] = useState<ActiveFloor | null>(() => getActiveFloor());
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
      { id: `pin-${n}`, label: `pin ${n}` },
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
    <Screen title="Walk">
      <View style={styles.readout}>
        <View>
          <ThemedText type="small" themeColor="textSecondary">
            Steps
          </ThemedText>
          <ThemedText type="subtitle" accessibilityLiveRegion="polite">
            {snapshot.stepCount}
          </ThemedText>
        </View>
        <View style={styles.heading}>
          <View style={[styles.needle, { transform: [{ rotate: `${heading}deg` }] }]}>
            <ThemedText type="subtitle" style={{ color: theme.accent }}>
              ↑
            </ThemedText>
          </View>
          <View>
            <ThemedText type="small" themeColor="textSecondary">
              Heading
            </ThemedText>
            <ThemedText type="subtitle">{Math.round(heading)}°</ThemedText>
          </View>
        </View>
      </View>
      {active ? (
        <View style={[styles.banner, { backgroundColor: theme.backgroundElement }]}>
          <View style={styles.bannerText}>
            <ThemedText type="small" themeColor="textSecondary">
              Viewing saved floor
            </ThemedText>
            <ThemedText type="smallBold">
              {active.buildingName} / {active.name}
            </ThemedText>
          </View>
          <Button label="Resume live walk" variant="primary" compact onPress={resume} />
        </View>
      ) : null}
      <View style={styles.legend}>
        <View style={styles.legendItem}>
          <View
            style={[styles.swatch, styles.swatchRaw, { backgroundColor: theme.textSecondary }]}
          />
          <ThemedText type="small" themeColor="textSecondary">
            Raw
          </ThemedText>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.swatch, { backgroundColor: theme.text }]} />
          <ThemedText type="small" themeColor="textSecondary">
            Corrected
          </ThemedText>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.dot, { backgroundColor: theme.accent }]} />
          <ThemedText type="small" themeColor="textSecondary">
            Pin
          </ThemedText>
        </View>
      </View>
      <SkiaWalk snapshot={snapshot} />
      {active ? null : <Button label="Drop pin" variant="primary" onPress={dropPin} />}
    </Screen>
  );
}

const styles = StyleSheet.create({
  readout: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
  },
  heading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  needle: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    padding: Spacing.three,
    borderRadius: Radius.medium,
  },
  bannerText: {
    flex: 1,
  },
  legend: {
    flexDirection: 'row',
    gap: Spacing.three,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
  },
  swatch: {
    width: 16,
    height: 3,
    borderRadius: 2,
  },
  swatchRaw: {
    height: 2,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
});
