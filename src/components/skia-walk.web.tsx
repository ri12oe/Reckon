import { type ComponentType, useEffect, useState } from 'react';
import { version } from 'canvaskit-wasm/package.json';

import { ThemedText } from '@/components/themed-text';

export default function SkiaWalk() {
  const [CanvasView, setCanvasView] = useState<ComponentType | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const { LoadSkiaWeb } = await import('@shopify/react-native-skia/lib/module/web');
      await LoadSkiaWeb({
        locateFile: (file) =>
          `https://cdn.jsdelivr.net/npm/canvaskit-wasm@${version}/bin/full/${file}`,
      });
      const canvas = await import('@/components/walk-canvas');
      if (!cancelled) {
        setCanvasView(() => canvas.default);
      }
    }

    void load().catch((caught: unknown) => {
      if (!cancelled) {
        setError(caught instanceof Error ? caught.message : 'canvas failed');
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return <ThemedText>{error}</ThemedText>;
  }

  if (!CanvasView) {
    return <ThemedText>loading canvas</ThemedText>;
  }

  return <CanvasView />;
}
