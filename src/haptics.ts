import * as Haptics from 'expo-haptics';

export function selectionHaptic() {
  void Haptics.selectionAsync().catch(() => undefined);
}

export function lightHaptic() {
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
}
