import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';

type Props = {
  total: number;
  done: number;
  value: string;
  caption: string;
  size?: number;
};

const TICK_LENGTH = 26;
const TICK_WIDTH = 12;

/** One tick per calibration step, lit as each step lands. */
export function StepRing({ total, done, value, caption, size = 220 }: Props) {
  const theme = useTheme();
  const radius = size / 2 - TICK_LENGTH / 2;

  return (
    <View
      style={[styles.ring, { width: size, height: size }]}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={caption}
      accessibilityValue={{ min: 0, max: total, now: Math.min(done, total) }}
    >
      {Array.from({ length: total }, (_, i) => {
        const angle = (i / total) * 360;
        const rad = (angle * Math.PI) / 180;
        const x = size / 2 + Math.sin(rad) * radius - TICK_WIDTH / 2;
        const y = size / 2 - Math.cos(rad) * radius - TICK_LENGTH / 2;
        return (
          <View
            key={i}
            style={[
              styles.tick,
              {
                left: x,
                top: y,
                transform: [{ rotate: `${angle}deg` }],
                backgroundColor: i < done ? theme.accent : theme.backgroundSelected,
              },
            ]}
          />
        );
      })}
      <ThemedText type="metricLarge">{value}</ThemedText>
      <ThemedText type="footnote" themeColor="textSecondary">
        {caption}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  ring: {
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tick: {
    position: 'absolute',
    width: TICK_WIDTH,
    height: TICK_LENGTH,
    borderRadius: TICK_WIDTH / 2,
  },
});
