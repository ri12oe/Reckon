import { type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

/** Android tabs inset the bottom edge themselves, and the web tab bar sits in the layout. */
export function TabBarInset({ children }: { children: ReactNode }) {
  return <View style={styles.fill}>{children}</View>;
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
});
