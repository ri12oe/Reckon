import WalkCanvas from '@/components/walk-canvas';
import type { EngineSnapshot } from '@/engine';

export default function SkiaWalk(props: { snapshot: EngineSnapshot; follow?: boolean }) {
  return <WalkCanvas {...props} />;
}
