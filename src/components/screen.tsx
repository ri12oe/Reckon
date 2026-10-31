import { type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { TabBarInset } from '@/components/tab-bar-inset';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';

export function Screen({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <ThemedView style={styles.screen}>
      <TabBarInset>
        <SafeAreaView edges={['top', 'left', 'right']} style={styles.safe}>
          <ThemedText type="subtitle">{title}</ThemedText>
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
  body: {
    flex: 1,
    gap: Spacing.three,
  },
});
