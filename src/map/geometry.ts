/**
 * Map camera math.
 *
 * Fitted points are pixels in the stage, north up, before the user zooms.
 * The camera is `stage = fitted * scale + translate`, with the origin at the
 * stage's top left. Pinch, drawing, and pin hits share that formula.
 */

import type { EngineSnapshot, PathPoint, Pin } from '@/engine';

export type MapPathMode = 'raw' | 'corrected';

export type XY = { x: number; y: number };

export type Bounds = { minX: number; maxX: number; minY: number; maxY: number };

export type MapTransform = {
  scale: number;
  translateX: number;
  translateY: number;
};

export type PinchBaseline = MapTransform & { focalX: number; focalY: number };

export const MAP_PAD = 24;
export const MIN_MAP_SCALE = 1;
export const MAX_MAP_SCALE = 6;
/** Screen pixels. Divided by the camera scale when testing fitted pin positions. */
export const PIN_HIT_RADIUS = 22;

export function pathForMode(snapshot: EngineSnapshot, mode: MapPathMode): PathPoint[] {
  return mode === 'raw' ? snapshot.rawPath : snapshot.correctedPath;
}

/** Both paths and the pins, so switching mode does not refit the camera. */
export function framePoints(snapshot: EngineSnapshot): XY[] {
  return [...snapshot.rawPath, ...snapshot.correctedPath, ...snapshot.pins];
}

export function boundsOf(points: readonly XY[]): Bounds | null {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
  }
  if (!Number.isFinite(minX)) return null;
  return { minX, maxX, minY, maxY };
}

export function makeProjector(frame: readonly XY[], width: number, height: number, pad = MAP_PAD) {
  const bounds = boundsOf(frame);
  if (!bounds || width <= pad * 2 || height <= pad * 2) return null;

  const spanX = Math.max(bounds.maxX - bounds.minX, 1);
  const spanY = Math.max(bounds.maxY - bounds.minY, 1);
  const scale = Math.min((width - pad * 2) / spanX, (height - pad * 2) / spanY);
  const offsetX = (width - spanX * scale) / 2;
  const offsetY = (height - spanY * scale) / 2;

  return (point: XY): XY => ({
    x: offsetX + (point.x - bounds.minX) * scale,
    y: offsetY + (bounds.maxY - point.y) * scale,
  });
}

export function pathToSvg(points: readonly XY[]): string {
  const finite = points.filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
  if (finite.length === 0) return '';
  const first = finite[0];
  let path = `M ${first.x} ${first.y}`;
  for (let i = 1; i < finite.length; i++) {
    const point = finite[i];
    path += ` L ${point.x} ${point.y}`;
  }
  return path;
}

export function clampMapScale(scale: number): number {
  'worklet';
  if (!Number.isFinite(scale)) return MIN_MAP_SCALE;
  return Math.min(MAX_MAP_SCALE, Math.max(MIN_MAP_SCALE, scale));
}

export function canvasToStage(
  point: XY,
  scale: number,
  translateX: number,
  translateY: number,
): XY {
  'worklet';
  return {
    x: point.x * scale + translateX,
    y: point.y * scale + translateY,
  };
}

export function stageToCanvas(
  point: XY,
  scale: number,
  translateX: number,
  translateY: number,
): XY {
  'worklet';
  const safe = scale === 0 ? 1 : scale;
  return {
    x: (point.x - translateX) / safe,
    y: (point.y - translateY) / safe,
  };
}

/**
 * Camera at the moment a pinch is first applied.
 * `gestureScale` is the handler's scale (1 at finger-down). Reapplying
 * `pinchAboutFocal` with the same focal and scale reproduces `current`.
 */
export function pinchBaseline(
  current: MapTransform,
  focal: XY,
  gestureScale: number,
): PinchBaseline {
  'worklet';
  const gesture = gestureScale === 0 ? 1 : gestureScale;
  return {
    scale: current.scale / gesture,
    translateX: (current.translateX - focal.x) / gesture + focal.x,
    translateY: (current.translateY - focal.y) / gesture + focal.y,
    focalX: focal.x,
    focalY: focal.y,
  };
}

export function pinchAboutFocal(
  start: PinchBaseline,
  focal: XY,
  gestureScale: number,
): MapTransform {
  'worklet';
  const scale = clampMapScale(start.scale * gestureScale);
  const ratio = start.scale === 0 ? 1 : scale / start.scale;
  return {
    scale,
    translateX: focal.x - (start.focalX - start.translateX) * ratio,
    translateY: focal.y - (start.focalY - start.translateY) * ratio,
  };
}

export function panBaseline(current: XY, translation: XY): XY {
  'worklet';
  return {
    x: current.x - translation.x,
    y: current.y - translation.y,
  };
}

export function panTo(baseline: XY, translation: XY): XY {
  'worklet';
  return {
    x: baseline.x + translation.x,
    y: baseline.y + translation.y,
  };
}

export function clampTranslation(
  translate: XY,
  scale: number,
  width: number,
  height: number,
  margin = 48,
): XY {
  'worklet';
  if (!(width > 0) || !(height > 0) || !(scale > 0)) return { x: translate.x, y: translate.y };
  const minX = margin - width * scale;
  const maxX = width - margin;
  const minY = margin - height * scale;
  const maxY = height - margin;
  return {
    x: Math.min(Math.max(minX, maxX), Math.max(Math.min(minX, maxX), translate.x)),
    y: Math.min(Math.max(minY, maxY), Math.max(Math.min(minY, maxY), translate.y)),
  };
}

export function hitTestPin<T extends XY>(pins: readonly T[], point: XY, radius: number): T | null {
  if (!(radius >= 0)) return null;
  let best: T | null = null;
  let bestDist = radius;
  for (const pin of pins) {
    if (!Number.isFinite(pin.x) || !Number.isFinite(pin.y)) continue;
    const dist = Math.hypot(pin.x - point.x, pin.y - point.y);
    if (dist <= bestDist && (best === null || dist < bestDist)) {
      best = pin;
      bestDist = dist;
    }
  }
  return best;
}

export type PlacedPin = Pin & XY;
