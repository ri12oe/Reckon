import { Skia, type SkPath, type SkPathBuilder } from '@shopify/react-native-skia';
import { useEffect, useState } from 'react';

import { drawStroke, type PlacedFrame, type Stroke, type XY } from '@/map/geometry';

export type StrokeMemory = {
  stroke: Stroke | null;
  path: SkPath | null;
  retired: SkPath | null;
  builder: SkPathBuilder | null;
};

export function createStrokeMemory(): StrokeMemory {
  return { stroke: null, path: null, retired: null, builder: null };
}

export function releaseStroke(memory: StrokeMemory) {
  memory.path?.dispose();
  memory.retired?.dispose();
  memory.builder?.dispose();
  memory.stroke = null;
  memory.path = null;
  memory.retired = null;
  memory.builder = null;
}

function retire(memory: StrokeMemory, next: SkPath | null) {
  // The picture redraw is async, so the path from the last update has to outlive this one.
  memory.retired?.dispose();
  memory.retired = memory.path;
  memory.path = next;
}

export function syncStroke(
  memory: StrokeMemory,
  points: readonly XY[],
  key: string,
  place: (point: XY) => XY,
): SkPath | null {
  const next = drawStroke(points, key, place, memory.stroke);
  if (next === memory.stroke) return memory.path;

  const builder = memory.builder ?? (memory.builder = Skia.PathBuilder.Make());
  const previous = memory.stroke;
  const append =
    previous !== null &&
    previous.source.length > 0 &&
    next.key === previous.key &&
    next.placed.length > previous.placed.length &&
    next.placed[previous.placed.length - 1] === previous.placed[previous.placed.length - 1];

  if (next.placed.length === 0) {
    builder.reset();
    memory.stroke = next;
    retire(memory, null);
    return null;
  }

  if (append && previous) {
    for (let i = previous.placed.length; i < next.placed.length; i++) {
      const point = next.placed[i];
      if (point) builder.lineTo(point.x, point.y);
    }
  } else {
    builder.reset();
    const first = next.placed[0];
    if (!first) {
      memory.stroke = next;
      retire(memory, null);
      return null;
    }
    builder.moveTo(first.x, first.y);
    for (let i = 1; i < next.placed.length; i++) {
      const point = next.placed[i];
      if (point) builder.lineTo(point.x, point.y);
    }
  }

  memory.stroke = next;
  const path = builder.build();
  retire(memory, path);
  return path;
}

export function useLiveStroke(
  points: readonly XY[],
  frame: PlacedFrame | null,
  keyPrefix = '',
): { path: SkPath | null; placed: readonly XY[] } {
  const [memory] = useState(createStrokeMemory);
  const key = frame ? `${keyPrefix}${frame.key}` : '';
  const path = frame ? syncStroke(memory, points, key, frame.place) : null;
  const placed = path && memory.stroke?.key === key ? memory.stroke.placed : [];
  useEffect(() => {
    return () => releaseStroke(memory);
  }, [memory]);
  return { path, placed };
}
