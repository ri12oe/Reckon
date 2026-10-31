import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { useTheme } from '@/hooks/use-theme';

const CELL = 28;

/** Full-bleed floor-plan grid behind the Walk and Map canvases. */
export function GridBackground() {
  const theme = useTheme();
  const [size, setSize] = useState({ width: 0, height: 0 });
  const columns = Math.ceil(size.width / CELL);
  const rows = Math.ceil(size.height / CELL);

  return (
    <View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, { backgroundColor: theme.canvas }]}
      onLayout={(event) => {
        const { width, height } = event.nativeEvent.layout;
        setSize((current) =>
          current.width === width && current.height === height ? current : { width, height },
        );
      }}
    >
      {Array.from({ length: columns }, (_, i) => (
        <View
          key={`c${i}`}
          style={[styles.column, { left: i * CELL + CELL / 2, backgroundColor: theme.grid }]}
        />
      ))}
      {Array.from({ length: rows }, (_, i) => (
        <View
          key={`r${i}`}
          style={[styles.row, { top: i * CELL + CELL / 2, backgroundColor: theme.grid }]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  column: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 1,
  },
  row: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 1,
  },
});
