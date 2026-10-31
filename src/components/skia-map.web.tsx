import { type ComponentType, useEffect, useState } from 'react';
import { View } from 'react-native';
import { version } from 'canvaskit-wasm/package.json';

import { ThemedText } from '@/components/themed-text';
import type { EngineSnapshot } from '@/engine';
import type { MapPathMode } from '@/map/geometry';

type MapProps = {
  snapshot: EngineSnapshot;
  mode: MapPathMode;
};

export default function SkiaMap(props: MapProps) {
  const [CanvasView, setCanvasView] = useState<ComponentType<MapProps> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const { LoadSkiaWeb } = await import('@shopify/react-native-skia/lib/module/web');
      await LoadSkiaWeb({
        locateFile: (file) =>
          `https://cdn.jsdelivr.net/npm/canvaskit-wasm@${version}/bin/full/${file}`,
      });
      const canvas = await import('@/components/floor-map');
      if (!cancelled) setCanvasView(() => canvas.default);
    }

    void load().catch((caught: unknown) => {
      if (!cancelled) setError(caught instanceof Error ? caught.message : 'canvas failed');
    });

    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return (
      <View style={fill}>
        <ThemedText>{error}</ThemedText>
      </View>
    );
  }

  if (!CanvasView) {
    return (
      <View style={fill}>
        <ThemedText>loading canvas</ThemedText>
      </View>
    );
  }

  return <CanvasView {...props} />;
}

const fill = { flex: 1, width: '100%' } as const;
