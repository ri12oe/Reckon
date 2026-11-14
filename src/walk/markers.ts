type XY = { x: number; y: number };

/**
 * A wedge pointing the way the walker faces, in screen space (y down).
 * `heading` is degrees clockwise from north, so 0 points up the screen.
 * A heading that is not a finite number draws nothing.
 */
export function headingCone(center: XY, heading: number, radius = 36, spread = 28): string {
  if (!Number.isFinite(heading)) return '';
  const steps = 6;
  const points: string[] = [];
  for (let i = 0; i <= steps; i++) {
    const angle = ((heading - spread + (2 * spread * i) / steps) * Math.PI) / 180;
    const x = center.x + Math.sin(angle) * radius;
    const y = center.y - Math.cos(angle) * radius;
    points.push(`L ${x.toFixed(2)} ${y.toFixed(2)}`);
  }
  return `M ${center.x} ${center.y} ${points.join(' ')} Z`;
}
