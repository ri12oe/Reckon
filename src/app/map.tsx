import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Screen } from '@/components/screen';
import SkiaMap from '@/components/skia-map';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { getEngine, type EngineSnapshot } from '@/engine';
import { useTheme } from '@/hooks/use-theme';
import type { MapPathMode } from '@/map/geometry';

/** The map reads the shared snapshot. It does not start the motion sensors. */
const POLL_MS = 250;

const modes = ['raw', 'corrected'] as const;

export default function MapScreen() {
  const theme = useTheme();
  const [snapshot, setSnapshot] = useState<EngineSnapshot>(() => getEngine().getSnapshot());
  const [mode, setMode] = useState<MapPathMode>('corrected');

  useFocusEffect(
    useCallback(() => {
      const engine = getEngine();
      const read = () => setSnapshot(engine.getSnapshot());
      read();
      const timer = setInterval(read, POLL_MS);
      return () => clearInterval(timer);
    }, []),
  );

  return (
    <Screen title="Map">
      <View style={styles.modes}>
        {modes.map((item) => {
          const selected = mode === item;
          return (
            <Pressable
              key={item}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              testID={`map-mode-${item}`}
              onPress={() => setMode(item)}
              style={[
                styles.mode,
                {
                  backgroundColor: selected ? theme.backgroundSelected : theme.backgroundElement,
                },
              ]}
            >
              <ThemedText type="small">{item}</ThemedText>
            </Pressable>
          );
        })}
      </View>
      <ThemedText type="small" themeColor="textSecondary">
        pinch to zoom, drag to pan
      </ThemedText>
      <SkiaMap snapshot={snapshot} mode={mode} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  modes: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  mode: {
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
  },
});
