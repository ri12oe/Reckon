import { Appearance, Platform } from 'react-native';

import { readAppearance, writeAppearance, type AppearancePreference } from '@/db/appearance';

export type { AppearancePreference } from '@/db/appearance';

type Scheme = 'light' | 'dark';

let current: AppearancePreference | null = null;
const listeners = new Set<() => void>();

/**
 * Native views (the iOS tab bar, status bar, alerts) follow the window's style,
 * so an in-app choice has to reach UIKit / AppCompat too. Web only reads the hook.
 */
function applyNative(preference: AppearancePreference) {
  if (Platform.OS === 'web') return;
  Appearance.setColorScheme(preference === 'system' ? 'unspecified' : preference);
}

function emit() {
  for (const listener of listeners) listener();
}

export function getAppearance(): AppearancePreference {
  if (current === null) {
    current = readAppearance();
    if (current !== 'system') applyNative(current);
  }
  return current;
}

export function setAppearance(preference: AppearancePreference): void {
  if (preference === getAppearance()) return;
  current = preference;
  writeAppearance(preference);
  applyNative(preference);
  emit();
}

/** Re-read the saved choice once the web database has opened. */
export function reloadAppearance(): void {
  const saved = readAppearance();
  if (saved === current) return;
  current = saved;
  applyNative(saved);
  emit();
}

export function subscribeAppearance(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** "System" follows the phone; Light and Dark override it for this app only. */
export function resolveScheme(
  preference: AppearancePreference,
  system: string | null | undefined,
): Scheme {
  if (preference !== 'system') return preference;
  return system === 'dark' ? 'dark' : 'light';
}
