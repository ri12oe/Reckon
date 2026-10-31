import { useFocusEffect } from 'expo-router';
import { type ComponentRef, useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Platform, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { AppearanceMenu } from '@/components/appearance-menu';
import { Button, IconButton } from '@/components/button';
import { FloorCard, THUMBNAIL_SIZE } from '@/components/floor-card';
import { Icon } from '@/components/icon';
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
import { pathThumbnail, type Thumbnail } from '@/map/thumbnail';
import { formatDistance, pathLength } from '@/walk/stats';

/** How long a save, load, or delete message stays up. */
const STATUS_MS = 4000;

export default function LibraryScreen() {
  const theme = useTheme();
  const [ready, setReady] = useState(Platform.OS !== 'web');
  const [building, setBuilding] = useState('');
  const [floorName, setFloorName] = useState('');
  const [floors, setFloors] = useState<FloorSummary[]>([]);
  const [status, setStatus] = useState('');
  const [details, setDetails] = useState<Record<string, FloorDetail>>({});
  const [query, setQuery] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(() => getActiveFloor()?.id ?? null);
  const [current, setCurrent] = useState(() => getEngine().getSnapshot());
  const scrollRef = useRef<ComponentRef<typeof ScrollView>>(null);
  const buildingRef = useRef<ComponentRef<typeof TextInput>>(null);
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
    const floorStore = getFloorStore();
    const list = floorStore.list();
    const next: Record<string, FloorDetail> = {};
    for (const item of list) {
      const path = floorStore.get(item.id)?.snapshot.correctedPath ?? [];
      next[item.id] = {
        distance: pathLength(path),
        thumbnail: pathThumbnail(path, THUMBNAIL_SIZE, 10),
      };
    }
    setFloors(list);
    setDetails(next);
    setActiveId(getActiveFloor()?.id ?? null);
    setCurrent(getEngine().getSnapshot());
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
      setBuilding('');
      setFloorName('');
      setStatus(`Saved ${saved.buildingName} · ${saved.name}.`);
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
    setActiveId(floor.id);
    setStatus(`Showing ${floor.buildingName} · ${floor.name} on Walk and Map.`);
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
    const label = floor ? `${floor.buildingName} · ${floor.name}` : 'this floor';
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

  const startNewFloor = () => {
    scrollRef.current?.scrollTo({ y: 0, animated: true });
    buildingRef.current?.focus();
  };

  const needle = query.trim().toLowerCase();
  const shown = needle
    ? floors.filter((item) => `${item.buildingName} ${item.name}`.toLowerCase().includes(needle))
    : floors;
  const count = `${floors.length} saved ${floors.length === 1 ? 'floor' : 'floors'}`;
  const input = [styles.input, { color: theme.text, backgroundColor: theme.backgroundSelected }];

  return (
    <Screen
      title="Library"
      subtitle={count}
      headerRight={
        <>
          <AppearanceMenu />
          <IconButton
            icon="plus"
            label="New floor"
            accessibilityHint="Name the current walk and save it as a floor"
            onPress={startNewFloor}
          />
        </>
      }
    >
      <ScrollView
        ref={scrollRef}
        style={styles.scroll}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        {store && !store.persistent ? (
          <ThemedText type="footnote" themeColor="textSecondary">
            SQLite is off in this browser. Floors stay in memory until you reload.
          </ThemedText>
        ) : null}

        {floors.length > 0 ? (
          <View style={[styles.search, { backgroundColor: theme.backgroundElement }]}>
            <Icon name="search" color={theme.textSecondary} size={18} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search buildings and floors"
              placeholderTextColor={theme.textTertiary}
              accessibilityLabel="Search saved floors"
              returnKeyType="search"
              style={[styles.searchInput, { color: theme.text }]}
            />
          </View>
        ) : null}

        <View style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
          <View style={styles.cardTitle}>
            <ThemedText type="headline">Save current walk</ThemedText>
            <ThemedText type="footnote" themeColor="textSecondary">
              {current.stepCount} steps · {formatDistance(pathLength(current.correctedPath))}
            </ThemedText>
          </View>
          <View style={styles.fields}>
            <TextInput
              ref={buildingRef}
              value={building}
              onChangeText={setBuilding}
              placeholder="Building"
              placeholderTextColor={theme.textTertiary}
              accessibilityLabel="Building name"
              style={input}
            />
            <TextInput
              value={floorName}
              onChangeText={setFloorName}
              placeholder="Floor"
              placeholderTextColor={theme.textTertiary}
              accessibilityLabel="Floor name"
              style={input}
            />
          </View>
          <Button
            label="Save floor"
            accessibilityLabel="Save current walk"
            variant="primary"
            icon="check"
            onPress={save}
          />
        </View>

        {status ? (
          <ThemedText type="footnote" themeColor="textSecondary" accessibilityLiveRegion="polite">
            {status}
          </ThemedText>
        ) : null}

        <ThemedText type="title2" accessibilityRole="header" style={styles.section}>
          Saved floors
        </ThemedText>
        {floors.length === 0 ? (
          <ThemedText themeColor="textSecondary">
            No saved floors yet. Walk a floor, then save it here.
          </ThemedText>
        ) : shown.length === 0 ? (
          <ThemedText themeColor="textSecondary">No floors match “{query.trim()}”.</ThemedText>
        ) : (
          shown.map((item) => {
            const detail = details[item.id];
            const pins = `${item.pinCount} ${item.pinCount === 1 ? 'pin' : 'pins'}`;
            return (
              <FloorCard
                key={item.id}
                building={item.buildingName}
                floor={item.name}
                meta={`${item.stepCount} steps · ${formatDistance(detail?.distance ?? 0)} · ${pins}`}
                thumbnail={detail?.thumbnail ?? EMPTY_THUMBNAIL}
                showing={activeId === item.id}
                expanded={expandedId === item.id}
                onLoad={() => load(item.id)}
                onToggleActions={() => setExpandedId((open) => (open === item.id ? null : item.id))}
                onShare={() => {
                  void share(item.id);
                }}
                onDelete={() => remove(item.id)}
              />
            );
          })
        )}
      </ScrollView>
    </Screen>
  );
}

type FloorDetail = { distance: number; thumbnail: Thumbnail };

const EMPTY_THUMBNAIL: Thumbnail = { segments: [], start: null };

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
  },
  content: {
    gap: Spacing.three,
    paddingBottom: Spacing.five,
  },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    minHeight: 44,
    paddingHorizontal: Spacing.three,
    borderRadius: 22,
  },
  searchInput: {
    flex: 1,
    fontSize: 17,
    paddingVertical: Spacing.two,
  },
  card: {
    gap: Spacing.three,
    padding: Spacing.three,
    borderRadius: Radius.card,
  },
  cardTitle: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  fields: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  input: {
    flex: 1,
    minWidth: 0,
    fontSize: 17,
    minHeight: 46,
    paddingHorizontal: Spacing.three,
    borderRadius: 14,
  },
  section: {
    marginTop: Spacing.two,
  },
});
