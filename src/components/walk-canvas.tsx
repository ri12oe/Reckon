import { Canvas, Circle, Group, Path } from '@shopify/react-native-skia';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { PathMarkers } from '@/components/path-markers';
import type { EngineSnapshot } from '@/engine';
import { useTheme } from '@/hooks/use-theme';
import { boundsOf, placeFrame } from '@/map/geometry';
import { useLiveStroke } from '@/map/live-stroke';

const PAD = 40;
const PIN_RADIUS = 6;
const FOLLOW_SPAN_M = 12;

type Props = {
  snapshot: EngineSnapshot;
  /** Frame the area around where you are instead of the whole walk. */
  follow?: boolean;
};

export default function WalkCanvas({ snapshot, follow = false }: Props) {
  const theme = useTheme();
  const [size, setSize] = useState({ width: 0, height: 0 });
  const here = snapshot.correctedPath[snapshot.correctedPath.length - 1];
  const framePoints =
    follow && here
      ? [
          { x: here.x - FOLLOW_SPAN_M / 2, y: here.y - FOLLOW_SPAN_M / 2 },
          { x: here.x + FOLLOW_SPAN_M / 2, y: here.y + FOLLOW_SPAN_M / 2 },
        ]
      : [...snapshot.rawPath, ...snapshot.correctedPath, ...snapshot.pins];
  const bounds = boundsOf(framePoints);
  const frame = bounds ? placeFrame(bounds, size.width, size.height, PAD) : null;
  const raw = useLiveStroke(snapshot.rawPath, frame);
  const corrected = useLiveStroke(snapshot.correctedPath, frame);
  const pins = frame ? snapshot.pins.map((pin) => ({ id: pin.id, ...frame.place(pin) })) : [];
  const start = corrected.placed[0] ?? null;
  const end = corrected.placed[corrected.placed.length - 1] ?? null;

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
          {raw.path ? (
            <Path
              path={raw.path}
              color={theme.pathRaw}
              style="stroke"
              strokeWidth={2}
              strokeCap="round"
              strokeJoin="round"
            />
          ) : null}
          {corrected.path ? (
            <Path
              path={corrected.path}
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
