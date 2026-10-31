import { Circle, Path } from '@shopify/react-native-skia';

import { withAlpha } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { headingCone } from '@/walk/markers';

type XY = { x: number; y: number };

type Props = {
  start: XY | null;
  end: XY | null;
  heading: number;
  /** Divide sizes by the map zoom so markers stay the same size on screen. */
  scale?: number;
};

/** Hollow ring where the walk began; blue dot, halo, and heading cone where you are. */
export function PathMarkers({ start, end, heading, scale = 1 }: Props) {
  const theme = useTheme();
  const k = 1 / Math.max(scale, 1e-6);

  return (
    <>
      {start ? (
        <Circle
          cx={start.x}
          cy={start.y}
          r={6 * k}
          color={theme.pathCorrected}
          style="stroke"
          strokeWidth={3 * k}
        />
      ) : null}
      {end ? (
        <>
          <Path path={headingCone(end, heading, 36 * k)} color={withAlpha(theme.accent, 0.3)} />
          <Circle cx={end.x} cy={end.y} r={22 * k} color={withAlpha(theme.accent, 0.18)} />
          <Circle cx={end.x} cy={end.y} r={10 * k} color="#ffffff" />
          <Circle cx={end.x} cy={end.y} r={7 * k} color={theme.accent} />
        </>
      ) : null}
    </>
  );
}
