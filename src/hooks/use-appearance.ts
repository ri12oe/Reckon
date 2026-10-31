import { useSyncExternalStore } from 'react';

import { getAppearance, subscribeAppearance, type AppearancePreference } from '@/appearance';

export function useAppearance(): AppearancePreference {
  return useSyncExternalStore(subscribeAppearance, getAppearance, () => 'system');
}
