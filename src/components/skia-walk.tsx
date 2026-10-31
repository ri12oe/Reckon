import WalkCanvas from '@/components/walk-canvas';
import type { EngineSnapshot } from '@/engine';

export default function SkiaWalk({ snapshot }: { snapshot: EngineSnapshot }) {
  return <WalkCanvas snapshot={snapshot} />;
}
