import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet } from 'react-native';

import { IconButton } from '@/components/button';
import { Glass } from '@/components/glass';
import { GridBackground } from '@/components/grid-background';
import { Screen } from '@/components/screen';
import SkiaMap from '@/components/skia-map';
import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { getFloorStore } from '@/db/floor-store';
import { getActiveFloor, type ActiveFloor } from '@/db/session';
import { liveWalkFloor, shareStoredFloor } from '@/db/share-floor';
import { getEngine, type EngineSnapshot } from '@/engine';
import { useTheme } from '@/hooks/use-theme';
import type { MapPathMode } from '@/map/geometry';
import { formatDistance, pathLength } from '@/walk/stats';

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

  const share = async () => {
    const saved = active ? getFloorStore().get(active.id) : null;
    try {
      await shareStoredFloor(saved ?? liveWalkFloor(getEngine().getSnapshot()));
    } catch {
      // The share sheet reports its own errors.
    }
  };

  const toggle = (
    <Glass style={styles.modes}>
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
    </Glass>
  );

  const pins = snapshot.pins.length;
  const summary = `${snapshot.stepCount} steps · ${formatDistance(
    pathLength(snapshot.correctedPath),
  )} · ${pins} ${pins === 1 ? 'pin' : 'pins'}`;

  return (
    <Screen
      title="Map"
      subtitle={active ? `${active.buildingName} · ${active.name}` : 'Live walk'}
      headerRight={
        <IconButton
          icon="share"
          label={active ? `Share ${active.buildingName} ${active.name}` : 'Share this walk'}
          onPress={() => {
            void share();
          }}
        />
      }
      background={<GridBackground />}
    >
      <SkiaMap snapshot={snapshot} mode={mode} summary={summary} toolbar={toggle} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  modes: {
    alignSelf: 'flex-start',
    width: 210,
    flexDirection: 'row',
    padding: Spacing.half + 1,
    borderRadius: Radius.large,
  },
  mode: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: Spacing.two,
    borderRadius: Radius.large - Spacing.half,
  },
});
