import { usePathname } from 'expo-router';
import { useEffect, useRef } from 'react';

import { selectionHaptic } from '@/haptics';

export function useTabHaptic() {
  const pathname = usePathname();
  const ready = useRef(false);

  useEffect(() => {
    if (!ready.current) {
      ready.current = true;
      return;
    }
    selectionHaptic();
  }, [pathname]);
}
