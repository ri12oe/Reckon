import { type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { TabBarInset } from '@/components/tab-bar-inset';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';

type Props = {
  title: string;
  subtitle?: string;
  /** Controls shown at the right of the title, such as the Appearance button. */
  headerRight?: ReactNode;
  /** Full-bleed layer drawn behind the whole screen, such as the map grid. */
  background?: ReactNode;
  children?: ReactNode;
};

export function Screen({ title, subtitle, headerRight, background, children }: Props) {
  return (
    <ThemedView style={styles.screen}>
      {background}
      <TabBarInset>
        <SafeAreaView edges={['top', 'left', 'right']} style={styles.safe}>
          <View style={styles.header}>
            <View style={styles.titles}>
              <ThemedText type="largeTitle" accessibilityRole="header">
                {title}
              </ThemedText>
              {subtitle ? (
                <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                  {subtitle}
                </ThemedText>
              ) : null}
            </View>
            {headerRight ? <View style={styles.right}>{headerRight}</View> : null}
          </View>
          <View style={styles.body}>{children}</View>
        </SafeAreaView>
      </TabBarInset>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    width: '100%',
  },
  safe: {
    flex: 1,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.three,
    gap: Spacing.three,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
    paddingHorizontal: Spacing.one,
  },
  titles: {
    flexShrink: 1,
  },
  right: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  body: {
    flex: 1,
    gap: Spacing.three,
  },
});
