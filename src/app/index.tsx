import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Screen } from '@/components/screen';
import SkiaWalk from '@/components/skia-walk';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { getEngine, type EngineSnapshot } from '@/engine';
import { lightHaptic } from '@/haptics';
import { useTheme } from '@/hooks/use-theme';

/** Re-read the engine often enough to track a step as it lands. */
const POLL_MS = 50;

export default function WalkScreen() {
  const theme = useTheme();
  const [snapshot, setSnapshot] = useState<EngineSnapshot>(() => getEngine().getSnapshot());
  const stepsRef = useRef(snapshot.stepCount);
  const droppedRef = useRef(0);

  useFocusEffect(
    useCallback(() => {
      const engine = getEngine();
      void engine.startSensors().catch(() => undefined);

      const read = () => {
        const next = engine.getSnapshot();
        if (next.stepCount > stepsRef.current) lightHaptic();
        stepsRef.current = next.stepCount;
        setSnapshot(next);
      };

      read();
      const timer = setInterval(read, POLL_MS);
      return () => {
        clearInterval(timer);
        engine.stopSensors();
      };
    }, []),
  );

  const dropPin = () => {
    const engine = getEngine();
    const point = engine.getSnapshot().correctedPath.at(-1);
    if (!point) return;
    droppedRef.current += 1;
    const n = droppedRef.current;
    engine.addPin({
      id: `pin-${n}`,
      x: point.x,
      y: point.y,
      label: `pin ${n}`,
    });
    setSnapshot(engine.getSnapshot());
  };

  const heading = Number.isFinite(snapshot.heading) ? snapshot.heading : 0;

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
      <SkiaWalk snapshot={snapshot} />
      <Pressable
        accessibilityRole="button"
        onPress={dropPin}
        style={[styles.pinButton, { backgroundColor: theme.backgroundElement }]}
      >
        <ThemedText>drop pin</ThemedText>
      </Pressable>
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
