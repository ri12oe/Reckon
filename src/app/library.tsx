import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Platform, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { AppearanceMenu } from '@/components/appearance-menu';
import { Button } from '@/components/button';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { ensureDatabase } from '@/db/database';
import { getFloorStore } from '@/db/floor-store';
import type { FloorSummary } from '@/db/floors';
import { getActiveFloor, resumeLiveWalk, showSavedFloor } from '@/db/session';
import { shareStoredFloor } from '@/db/share-floor';
import { getEngine } from '@/engine';
import { useTheme } from '@/hooks/use-theme';

/** How long a save, load, or delete message stays up. */
const STATUS_MS = 4000;

export default function LibraryScreen() {
  const theme = useTheme();
  const [ready, setReady] = useState(Platform.OS !== 'web');
  const [building, setBuilding] = useState('');
  const [floorName, setFloorName] = useState('');
  const [floors, setFloors] = useState<FloorSummary[]>([]);
  const [status, setStatus] = useState('');
  const store = ready ? getFloorStore() : null;

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    let cancelled = false;
    void ensureDatabase().then(() => {
      if (!cancelled) setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!status) return;
    const timer = setTimeout(() => setStatus(''), STATUS_MS);
    return () => clearTimeout(timer);
  }, [status]);

  const reload = useCallback(() => {
    setFloors(getFloorStore().list());
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (!ready) return;
      reload();
    }, [ready, reload]),
  );

  const save = () => {
    if (!store) return;
    try {
      const saved = store.save({
        buildingName: building,
        floorName,
        snapshot: getEngine().getSnapshot(),
      });
      reload();
      setStatus(`Saved ${saved.buildingName} / ${saved.name}.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Could not save.');
    }
  };

  const load = (id: string) => {
    if (!store) return;
    const floor = store.get(id);
    if (!floor) {
      setStatus('That floor is no longer saved.');
      reload();
      return;
    }
    showSavedFloor(floor);
    setStatus(`Loaded ${floor.buildingName} / ${floor.name} into Walk and Map.`);
  };

  const share = async (id: string) => {
    if (!store) return;
    const floor = store.get(id);
    if (!floor) {
      setStatus('That floor is no longer saved.');
      reload();
      return;
    }
    try {
      setStatus(await shareStoredFloor(floor));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Could not share.');
    }
  };

  const remove = (id: string) => {
    const floor = floors.find((item) => item.id === id);
    const label = floor ? `${floor.buildingName} / ${floor.name}` : 'this floor';
    const run = () => {
      if (!store) return;
      store.delete(id);
      if (getActiveFloor()?.id === id) resumeLiveWalk();
      reload();
      setStatus(`Deleted ${label}.`);
    };
    if (Platform.OS === 'web') {
      if (typeof window !== 'undefined' && window.confirm(`Delete ${label}?`)) run();
      return;
    }
    Alert.alert('Delete floor', `Delete ${label}?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: run },
    ]);
  };

  return (
    <Screen title="Library" headerRight={<AppearanceMenu />}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        {store && !store.persistent ? (
          <ThemedText type="small" themeColor="textSecondary">
            SQLite is off in this browser. Floors stay in memory until you reload.
          </ThemedText>
        ) : null}
        <ThemedText type="smallBold">Save this walk</ThemedText>
        <TextInput
          value={building}
          onChangeText={setBuilding}
          placeholder="Building name"
          placeholderTextColor={theme.textSecondary}
          accessibilityLabel="Building name"
          style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
        />
        <TextInput
          value={floorName}
          onChangeText={setFloorName}
          placeholder="Floor name"
          placeholderTextColor={theme.textSecondary}
          accessibilityLabel="Floor name"
          style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
        />
        <Button label="Save current walk" variant="primary" onPress={save} />
        {status ? (
          <ThemedText type="small" themeColor="textSecondary" accessibilityLiveRegion="polite">
            {status}
          </ThemedText>
        ) : null}
        <ThemedText type="smallBold" style={styles.section}>
          Saved floors
        </ThemedText>
        {floors.length === 0 ? (
          <ThemedText themeColor="textSecondary">No saved floors yet.</ThemedText>
        ) : (
          floors.map((item) => (
            <View key={item.id} style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
              <ThemedText type="smallBold">
                {item.buildingName} / {item.name}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {item.stepCount} steps · {item.pointCount} points · {item.pinCount} pins
              </ThemedText>
              <View style={styles.actions}>
                <Button
                  label="Load"
                  accessibilityLabel={`Load ${item.buildingName} ${item.name}`}
                  compact
                  onPress={() => load(item.id)}
                />
                <Button
                  label="Share"
                  accessibilityLabel={`Share ${item.buildingName} ${item.name}`}
                  compact
                  onPress={() => {
                    void share(item.id);
                  }}
                />
                <View style={styles.spacer} />
                <Button
                  label="Delete"
                  accessibilityLabel={`Delete ${item.buildingName} ${item.name}`}
                  variant="destructive"
                  compact
                  onPress={() => remove(item.id)}
                />
              </View>
            </View>
          ))
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
  },
  content: {
    gap: Spacing.three,
    paddingBottom: Spacing.five,
  },
  input: {
    fontSize: 16,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    borderRadius: Radius.medium,
  },
  section: {
    marginTop: Spacing.three,
  },
  card: {
    gap: Spacing.two,
    padding: Spacing.three,
    borderRadius: Radius.medium,
  },
  actions: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  spacer: {
    flex: 1,
  },
});
