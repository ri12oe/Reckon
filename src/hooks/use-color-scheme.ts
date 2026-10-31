import { useColorScheme as useRNColorScheme } from 'react-native';

import { resolveScheme } from '@/appearance';
import { useAppearance } from '@/hooks/use-appearance';

/** The phone's scheme unless the in-app Appearance setting overrides it. */
export function useColorScheme() {
  const system = useRNColorScheme();
  const preference = useAppearance();
  return resolveScheme(preference, system);
}
