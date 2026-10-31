import FloorMap from '@/components/floor-map';
import type { EngineSnapshot } from '@/engine';
import type { MapPathMode } from '@/map/geometry';

type Props = {
  snapshot: EngineSnapshot;
  mode: MapPathMode;
};

export default function SkiaMap(props: Props) {
  return <FloorMap {...props} />;
}
