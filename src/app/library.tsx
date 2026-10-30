import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { getEngine } from '@/engine';

export default function LibraryScreen() {
  const { stepCount } = getEngine().getSnapshot();

  return (
    <Screen title="Library">
      <ThemedText>saved walks will go here</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        engine sample has {stepCount} steps
      </ThemedText>
    </Screen>
  );
}
