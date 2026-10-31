import { type ComponentType, type ReactNode, useEffect, useState } from 'react';
import { View } from 'react-native';
import { version } from 'canvaskit-wasm/package.json';

import { ThemedText } from '@/components/themed-text';
import type { EngineSnapshot } from '@/engine';
import type { MapPathMode } from '@/map/geometry';

type MapProps = {
  snapshot: EngineSnapshot;
  mode: MapPathMode;
  summary?: string;
  toolbar?: ReactNode;
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

  if (error || !CanvasView) {
    return (
      <View style={fill}>
        {props.toolbar}
        <ThemedText type="small" themeColor="textSecondary" style={center}>
          {error ?? 'Loading map…'}
        </ThemedText>
      </View>
    );
  }

  return <CanvasView {...props} />;
}

const fill = { flex: 1, width: '100%', gap: 8 } as const;
const center = { textAlign: 'center', marginTop: 24 } as const;
