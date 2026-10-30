import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { getEngine } from '@/engine';

export default function MapScreen() {
  const { pins } = getEngine().getSnapshot();

  return (
    <Screen title="Map">
      <ThemedText>map will go here</ThemedText>
      {pins.map((pin) => (
        <ThemedText key={pin.id} type="small" themeColor="textSecondary">
          {pin.label} ({pin.x}, {pin.y})
        </ThemedText>
      ))}
    </Screen>
  );
}
