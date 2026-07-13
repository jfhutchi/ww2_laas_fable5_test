export interface RoofSegment {
  center: number;
  width: number;
}

export function survivingRoofSegments(
  fullLeft: number,
  fullRight: number,
  holeLeft: number,
  holeRight: number,
): RoofSegment[] {
  const left = Math.max(fullLeft, Math.min(fullRight, holeLeft));
  const right = Math.max(left, Math.min(fullRight, holeRight));
  const segments: RoofSegment[] = [];
  if (left - fullLeft > 0.08) segments.push({ center: (fullLeft + left) * 0.5, width: left - fullLeft });
  if (fullRight - right > 0.08) segments.push({ center: (right + fullRight) * 0.5, width: fullRight - right });
  return segments;
}
