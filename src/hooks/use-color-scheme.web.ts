import { useSyncExternalStore } from 'react';
import { useColorScheme as useRNColorScheme } from 'react-native';

import { resolveScheme } from '@/appearance';
import { useAppearance } from '@/hooks/use-appearance';

function subscribe() {
  return () => {};
}

/**
 * Static render uses light mode. After hydration, use the client color scheme
 * unless the in-app Appearance setting overrides it.
 */
export function useColorScheme() {
  const colorScheme = resolveScheme(useAppearance(), useRNColorScheme());
  const hasHydrated = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );

  if (hasHydrated) {
    return colorScheme;
  }

  return 'light';
}
