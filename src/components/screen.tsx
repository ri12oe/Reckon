import { type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { TabBarInset } from '@/components/tab-bar-inset';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';

type Props = {
  title: string;
  /** Controls shown at the right of the title, such as the Appearance button. */
  headerRight?: ReactNode;
  children?: ReactNode;
};

export function Screen({ title, headerRight, children }: Props) {
  return (
    <ThemedView style={styles.screen}>
      <TabBarInset>
        <SafeAreaView edges={['top', 'left', 'right']} style={styles.safe}>
          <View style={styles.header}>
            <ThemedText type="subtitle" accessibilityRole="header">
              {title}
            </ThemedText>
            {headerRight}
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
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.three,
    gap: Spacing.three,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
  },
  body: {
    flex: 1,
    gap: Spacing.three,
  },
});
