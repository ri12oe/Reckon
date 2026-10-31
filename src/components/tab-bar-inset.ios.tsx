import { type ReactNode } from 'react';
import { StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-screens/experimental';

/**
 * Keeps content above the floating iOS tab bar. Native tabs only inset the
 * first ScrollView on iOS, so screens with fixed layouts need this. Android
 * tabs already wrap each screen the same way.
 */
export function TabBarInset({ children }: { children: ReactNode }) {
  return (
    <SafeAreaView collapsable={false} edges={{ bottom: true }} insetType="all" style={styles.fill}>
      {children}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
});
