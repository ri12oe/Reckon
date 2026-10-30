import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { getEngine } from '@/engine';

export default function CalibrationScreen() {
  const { heading } = getEngine().getSnapshot();

  return (
    <Screen title="Calibration">
      <ThemedText>calibration will go here</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        engine heading {heading}°
      </ThemedText>
    </Screen>
  );
}
