import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { ensureDatabase } from '@/db/database';
import { getFloorStore } from '@/db/floor-store';
import type { FloorSummary } from '@/db/floors';
import { getActiveFloor, resumeLiveWalk, showSavedFloor } from '@/db/session';
import { shareStoredFloor } from '@/db/share-floor';
import { getEngine } from '@/engine';
import { useTheme } from '@/hooks/use-theme';

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
    <Screen title="Library">
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
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Save current walk"
          onPress={save}
          style={[styles.button, { backgroundColor: theme.backgroundElement }]}
        >
          <ThemedText>Save current walk</ThemedText>
        </Pressable>
        {status ? <ThemedText type="small">{status}</ThemedText> : null}
        {floors.length === 0 ? (
          <ThemedText>No saved floors yet.</ThemedText>
        ) : (
          floors.map((item) => (
            <View key={item.id} style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
              <ThemedText>
                {item.buildingName} / {item.name}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {item.stepCount} steps · {item.pointCount} points · {item.pinCount} pins
              </ThemedText>
              <View style={styles.actions}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Load ${item.buildingName} ${item.name}`}
                  onPress={() => load(item.id)}
                  style={[styles.button, { backgroundColor: theme.backgroundSelected }]}
                >
                  <ThemedText>Load</ThemedText>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Share ${item.buildingName} ${item.name}`}
                  onPress={() => {
                    void share(item.id);
                  }}
                  style={[styles.button, { backgroundColor: theme.backgroundSelected }]}
                >
                  <ThemedText>Share</ThemedText>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Delete ${item.buildingName} ${item.name}`}
                  onPress={() => remove(item.id)}
                  style={[styles.button, { backgroundColor: theme.backgroundSelected }]}
                >
                  <ThemedText>Delete</ThemedText>
                </Pressable>
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
  },
  button: {
    alignItems: 'center',
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.three,
  },
  card: {
    gap: Spacing.two,
    padding: Spacing.three,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
});
