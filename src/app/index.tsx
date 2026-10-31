import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Screen } from '@/components/screen';
import SkiaWalk from '@/components/skia-walk';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
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
        <ThemedText>steps {snapshot.stepCount}</ThemedText>
        <View style={styles.heading}>
          <View style={[styles.needle, { transform: [{ rotate: `${heading}deg` }] }]}>
            <ThemedText>↑</ThemedText>
          </View>
          <ThemedText>heading {Math.round(heading)}°</ThemedText>
        </View>
      </View>
      <ThemedText type="small" themeColor="textSecondary">
        thin line is raw, thick line is corrected
      </ThemedText>
      {active ? (
        <ThemedText type="small">
          saved floor {active.buildingName} / {active.name}
        </ThemedText>
      ) : null}
      <SkiaWalk snapshot={snapshot} />
      {active ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Resume live walk"
          onPress={resume}
          style={[styles.pinButton, { backgroundColor: theme.backgroundElement }]}
        >
          <ThemedText>resume live walk</ThemedText>
        </Pressable>
      ) : (
        <Pressable
          accessibilityRole="button"
          onPress={dropPin}
          style={[styles.pinButton, { backgroundColor: theme.backgroundElement }]}
        >
          <ThemedText>drop pin</ThemedText>
        </Pressable>
      )}
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
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pinButton: {
    alignItems: 'center',
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.four,
  },
});
