import { Canvas, Circle, Group, Path } from '@shopify/react-native-skia';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { PathMarkers } from '@/components/path-markers';
import type { EngineSnapshot, PathPoint } from '@/engine';
import { useTheme } from '@/hooks/use-theme';

const PAD = 40;
const PIN_RADIUS = 6;
/** Meters shown around you in follow mode. */
const FOLLOW_SPAN_M = 12;

type XY = { x: number; y: number };

function boundsOf(points: readonly XY[]) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
  }
  return { minX, maxX, minY, maxY };
}

function makeProjector(frame: readonly XY[], width: number, height: number) {
  if (frame.length === 0 || width <= PAD * 2 || height <= PAD * 2) return null;

  const { minX, maxX, minY, maxY } = boundsOf(frame);
  const spanX = Math.max(maxX - minX, 1);
  const spanY = Math.max(maxY - minY, 1);
  const scale = Math.min((width - PAD * 2) / spanX, (height - PAD * 2) / spanY);
  const offsetX = (width - spanX * scale) / 2;
  const offsetY = (height - spanY * scale) / 2;

  return (point: XY): XY => ({
    x: offsetX + (point.x - minX) * scale,
    y: offsetY + (maxY - point.y) * scale,
  });
}

function project(points: readonly PathPoint[], place: (point: XY) => XY) {
  if (points.length === 0) return '';
  const first = place(points[0]);
  const rest = points.slice(1).map((point) => {
    const placed = place(point);
    return `L ${placed.x} ${placed.y}`;
  });
  return `M ${first.x} ${first.y} ${rest.join(' ')}`;
}

type Props = {
  snapshot: EngineSnapshot;
  /** Frame the area around where you are instead of the whole walk. */
  follow?: boolean;
};

export default function WalkCanvas({ snapshot, follow = false }: Props) {
  const theme = useTheme();
  const [size, setSize] = useState({ width: 0, height: 0 });
  const here = snapshot.correctedPath[snapshot.correctedPath.length - 1];
  const frame =
    follow && here
      ? [
          { x: here.x - FOLLOW_SPAN_M / 2, y: here.y - FOLLOW_SPAN_M / 2 },
          { x: here.x + FOLLOW_SPAN_M / 2, y: here.y + FOLLOW_SPAN_M / 2 },
        ]
      : [...snapshot.rawPath, ...snapshot.correctedPath, ...snapshot.pins];
  const place = makeProjector(frame, size.width, size.height);
  const raw = place ? project(snapshot.rawPath, place) : '';
  const corrected = place ? project(snapshot.correctedPath, place) : '';
  const pins = place ? snapshot.pins.map((pin) => ({ id: pin.id, ...place(pin) })) : [];
  const path = snapshot.correctedPath;
  const start = place && path.length > 0 ? place(path[0]) : null;
  const end = place && path.length > 0 ? place(path[path.length - 1]) : null;

  return (
    <View
      style={styles.fill}
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
            <Path
              path={raw}
              color={theme.pathRaw}
              style="stroke"
              strokeWidth={2}
              strokeCap="round"
              strokeJoin="round"
            />
          ) : null}
          {corrected ? (
            <Path
              path={corrected}
              color={theme.pathCorrected}
              style="stroke"
              strokeWidth={4}
              strokeCap="round"
              strokeJoin="round"
            />
          ) : null}
          <PathMarkers start={start} end={end} heading={snapshot.heading} />
          {pins.map((pin) => (
            <Group key={pin.id}>
              <Circle cx={pin.x} cy={pin.y} r={PIN_RADIUS + 2.5} color="#ffffff" />
              <Circle cx={pin.x} cy={pin.y} r={PIN_RADIUS} color={theme.accent} />
            </Group>
          ))}
        </Canvas>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
    width: '100%',
  },
});
