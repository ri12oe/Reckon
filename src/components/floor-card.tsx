import { Pressable, StyleSheet, View } from 'react-native';

import { Button, IconButton } from '@/components/button';
import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing, withAlpha } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { Thumbnail } from '@/map/thumbnail';

export const THUMBNAIL_SIZE = 64;

type Props = {
  building: string;
  floor: string;
  meta: string;
  thumbnail: Thumbnail;
  showing: boolean;
  expanded: boolean;
  onLoad(): void;
  onToggleActions(): void;
  onShare(): void;
  onDelete(): void;
};

function PathPreview({ thumbnail }: { thumbnail: Thumbnail }) {
  const theme = useTheme();
  return (
    <View style={[styles.preview, { backgroundColor: theme.background }]}>
      {thumbnail.segments.map((s, i) => (
        <View
          key={i}
          style={[
            styles.segment,
            {
              width: s.length + 2.5,
              left: s.x - (s.length + 2.5) / 2,
              top: s.y - 1.25,
              transform: [{ rotate: `${s.angle}rad` }],
              backgroundColor: theme.pathCorrected,
            },
          ]}
        />
      ))}
      {thumbnail.start ? (
        <View
          style={[
            styles.start,
            { left: thumbnail.start.x - 3.5, top: thumbnail.start.y - 3.5 },
            { backgroundColor: theme.accent },
          ]}
        />
      ) : null}
    </View>
  );
}

/** A saved floor: tap to load into Walk and Map; ••• for Share and Delete. */
export function FloorCard({
  building,
  floor,
  meta,
  thumbnail,
  showing,
  expanded,
  onLoad,
  onToggleActions,
  onShare,
  onDelete,
}: Props) {
  const theme = useTheme();
  return (
    <View style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
      <View style={styles.row}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Load ${building} ${floor}`}
          accessibilityHint="Shows this floor on Walk and Map"
          accessibilityState={{ selected: showing }}
          onPress={onLoad}
          style={({ pressed }) => [styles.main, { opacity: pressed ? 0.7 : 1 }]}
        >
          <PathPreview thumbnail={thumbnail} />
          <View style={styles.text}>
            {showing ? (
              <View style={[styles.badge, { backgroundColor: withAlpha(theme.success, 0.18) }]}>
                <View style={[styles.badgeDot, { backgroundColor: theme.success }]} />
                <ThemedText type="caption" style={{ color: theme.success }}>
                  Showing
                </ThemedText>
              </View>
            ) : null}
            <ThemedText type="headline" numberOfLines={1}>
              {floor}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
              {building}
            </ThemedText>
            <ThemedText type="footnote" themeColor="textTertiary" numberOfLines={1}>
              {meta}
            </ThemedText>
          </View>
        </Pressable>
        <IconButton
          icon="more"
          label={`More actions for ${building} ${floor}`}
          variant="plain"
          size={40}
          color={theme.textSecondary}
          accessibilityState={{ expanded }}
          onPress={onToggleActions}
        />
      </View>
      {expanded ? (
        <View style={styles.actions}>
          <Button
            label="Share"
            icon="share"
            compact
            accessibilityLabel={`Share ${building} ${floor}`}
            onPress={onShare}
          />
          <Button
            label="Delete"
            icon="trash"
            variant="destructive"
            compact
            accessibilityLabel={`Delete ${building} ${floor}`}
            onPress={onDelete}
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: Spacing.three - Spacing.one,
    borderRadius: Radius.large,
    gap: Spacing.three,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
  },
  main: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  preview: {
    width: THUMBNAIL_SIZE,
    height: THUMBNAIL_SIZE,
    borderRadius: 14,
    overflow: 'hidden',
  },
  segment: {
    position: 'absolute',
    height: 2.5,
    borderRadius: 1.25,
  },
  start: {
    position: 'absolute',
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  text: {
    flex: 1,
    gap: 1,
  },
  badge: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    paddingHorizontal: Spacing.two - 1,
    paddingVertical: 2,
    borderRadius: Radius.small,
    marginBottom: 2,
  },
  badgeDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  actions: {
    flexDirection: 'row',
    gap: Spacing.two,
    paddingLeft: THUMBNAIL_SIZE + Spacing.three,
  },
});
