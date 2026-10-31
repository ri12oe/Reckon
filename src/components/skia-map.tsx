import type { ReactNode } from 'react';

import FloorMap from '@/components/floor-map';
import type { EngineSnapshot } from '@/engine';
import type { MapPathMode } from '@/map/geometry';

type Props = {
  snapshot: EngineSnapshot;
  mode: MapPathMode;
  summary?: string;
  toolbar?: ReactNode;
};

export default function SkiaMap(props: Props) {
  return <FloorMap {...props} />;
}
