import { Canvas, Path } from '@shopify/react-native-skia';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { getEngine, type PathPoint } from '@/engine';
import { useTheme } from '@/hooks/use-theme';

const PAD = 24;

function project(points: PathPoint[], frame: PathPoint[], width: number, height: number) {
  if (points.length === 0 || frame.length === 0 || width <= PAD * 2 || height <= PAD * 2) {
    return '';
  }

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const point of frame) {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
  }

  const spanX = Math.max(maxX - minX, 1);
  const spanY = Math.max(maxY - minY, 1);
  const scale = Math.min((width - PAD * 2) / spanX, (height - PAD * 2) / spanY);
  const offsetX = (width - spanX * scale) / 2;
  const offsetY = (height - spanY * scale) / 2;

  const xy = (point: PathPoint) => {
    const x = offsetX + (point.x - minX) * scale;
    const y = offsetY + (maxY - point.y) * scale;
    return `${x} ${y}`;
  };

  return `M ${xy(points[0])} ${points
    .slice(1)
    .map((point) => `L ${xy(point)}`)
    .join(' ')}`;
}

export default function WalkCanvas() {
  const snapshot = getEngine().getSnapshot();
  const theme = useTheme();
  const [size, setSize] = useState({ width: 0, height: 0 });
  const frame = [...snapshot.rawPath, ...snapshot.correctedPath];
  const raw = project(snapshot.rawPath, frame, size.width, size.height);
  const corrected = project(snapshot.correctedPath, frame, size.width, size.height);

  return (
    <View style={styles.fill}>
      <ThemedText>
        steps {snapshot.stepCount} · heading {snapshot.heading}°
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        thin line is raw, thick line is corrected
      </ThemedText>
      <View
        style={styles.canvas}
        onLayout={(event) => {
          const { width, height } = event.nativeEvent.layout;
          setSize((current) =>
            current.width === width && current.height === height ? current : { width, height },
          );
        }}
      >
        {size.width > 0 && size.height > 0 ? (
          <Canvas style={StyleSheet.absoluteFill}>
            {raw ? (
              <Path path={raw} color={theme.textSecondary} style="stroke" strokeWidth={2} />
            ) : null}
            {corrected ? (
              <Path path={corrected} color={theme.text} style="stroke" strokeWidth={3} />
            ) : null}
          </Canvas>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
    width: '100%',
    gap: Spacing.two,
  },
  canvas: {
    flex: 1,
    width: '100%',
  },
});
