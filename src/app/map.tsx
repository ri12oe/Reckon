import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Screen } from '@/components/screen';
import SkiaMap from '@/components/skia-map';
import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { getActiveFloor, type ActiveFloor } from '@/db/session';
import { getEngine, type EngineSnapshot } from '@/engine';
import { useTheme } from '@/hooks/use-theme';
import type { MapPathMode } from '@/map/geometry';

/** The map reads the shared snapshot. It does not start the motion sensors. */
const POLL_MS = 250;

const modes = ['raw', 'corrected'] as const;
const labels = { raw: 'Raw', corrected: 'Corrected' } as const;

export default function MapScreen() {
  const theme = useTheme();
  const [snapshot, setSnapshot] = useState<EngineSnapshot>(() => getEngine().getSnapshot());
  const [mode, setMode] = useState<MapPathMode>('corrected');
  const [active, setActive] = useState<ActiveFloor | null>(() => getActiveFloor());

  useFocusEffect(
    useCallback(() => {
      const engine = getEngine();
      const read = () => {
        setSnapshot(engine.getSnapshot());
        setActive(getActiveFloor());
      };
      read();
      const timer = setInterval(read, POLL_MS);
      return () => clearInterval(timer);
    }, []),
  );

  return (
    <Screen title="Map">
      {active ? (
        <ThemedText type="smallBold">
          {active.buildingName} / {active.name}
        </ThemedText>
      ) : null}
      <View style={[styles.modes, { backgroundColor: theme.backgroundElement }]}>
        {modes.map((item) => {
          const selected = mode === item;
          return (
            <Pressable
              key={item}
              accessibilityRole="button"
              accessibilityLabel={`${labels[item]} path`}
              accessibilityState={{ selected }}
              testID={`map-mode-${item}`}
              onPress={() => setMode(item)}
              style={[styles.mode, selected && { backgroundColor: theme.accent }]}
            >
              <ThemedText
                type="smallBold"
                style={{ color: selected ? theme.onAccent : theme.textSecondary }}
              >
                {labels[item]}
              </ThemedText>
            </Pressable>
          );
        })}
      </View>
      <ThemedText type="small" themeColor="textSecondary">
        {snapshot.stepCount} steps · {snapshot.correctedPath.length} points · {snapshot.pins.length}{' '}
        pins
      </ThemedText>
      <SkiaMap snapshot={snapshot} mode={mode} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  modes: {
    flexDirection: 'row',
    padding: Spacing.half,
    borderRadius: Radius.small + Spacing.half,
  },
  mode: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: Spacing.two,
    borderRadius: Radius.small,
  },
});
