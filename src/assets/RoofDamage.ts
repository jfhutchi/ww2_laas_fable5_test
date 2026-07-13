export interface RoofSegment {
  center: number;
  width: number;
}

export interface RoofBreachBounds {
  left: number;
  right: number;
}

/** Deterministic, independently ragged edges for one damaged tile course. */
export function roofBreachBounds(
  width: number,
  holeX0: number,
  holeX1: number,
  row: number,
  edgePhase: number,
): RoofBreachBounds {
  const phase = edgePhase * Math.PI * 2;
  const baseLeft = holeX0 * width;
  const baseRight = holeX1 * width;
  const leftWave =
    (Math.sin(row * 2.17 + phase) * 0.05 + Math.sin(row * 0.83 + phase * 1.7) * 0.018) * width;
  const rightWave =
    (Math.sin(row * 1.63 + phase + 2.1) * 0.05 + Math.sin(row * 2.71 - phase * 0.6) * 0.018) * width;
  let left = Math.max(-width * 0.48, baseLeft + leftWave);
  let right = Math.min(width * 0.48, baseRight + rightWave);
  const minGap = width * 0.2;
  if (right - left < minGap) {
    const center = (left + right) * 0.5;
    left = center - minGap * 0.5;
    right = center + minGap * 0.5;
  }
  return { left, right };
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
