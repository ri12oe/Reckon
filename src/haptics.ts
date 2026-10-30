import * as Haptics from 'expo-haptics';

export function selectionHaptic() {
  void Haptics.selectionAsync().catch(() => undefined);
}
