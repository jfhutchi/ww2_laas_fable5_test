/**
 * Cloud-shadow coverage field: a deterministic CPU-baked cumulus coverage
 * map sampled in post to (a) darken ground under drifting cloud banks and
 * (b) modulate the aerial in-scatter at the ray midpoint, which reads as
 * crepuscular light shafts sweeping the battlefield as the field drifts.
 */

import { DataTexture, LinearFilter, MirroredRepeatWrapping, RGBAFormat, UnsignedByteType } from 'three';
import { fbm2D } from '../core/Noise.ts';
import { smoothstep } from '../core/MathUtil.ts';

export interface CloudCoverage {
  texture: DataTexture;
  /** World meters covered by one texture repeat. */
  span: number;
  /** Wind drift direction (unit) and speed (m/s). */
  windX: number;
  windZ: number;
  windSpeed: number;
}

const N = 512;

export function buildCloudCoverage(seed: number): CloudCoverage {
  const data = new Uint8Array(N * N * 4);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      // broken-cumulus coverage: patchy banks with soft edges
      const base = fbm2D(x * 0.013, y * 0.013, seed ^ 0xc10d, 4);
      const detail = fbm2D(x * 0.05, y * 0.05, seed ^ 0xd41f, 3);
      let c = smoothstep(0.52, 0.74, base + detail * 0.18 - 0.09);
      // soften interiors so shadows are not flat blobs
      c *= 0.65 + 0.35 * detail;
      const v = Math.round(c * 255);
      const i = (y * N + x) * 4;
      data[i] = v;
      data[i + 1] = v;
      data[i + 2] = v;
      data[i + 3] = 255;
    }
  }
  const texture = new DataTexture(data, N, N, RGBAFormat, UnsignedByteType);
  texture.wrapS = MirroredRepeatWrapping;
  texture.wrapT = MirroredRepeatWrapping;
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearFilter;
  texture.needsUpdate = true;

  // wind from the seed — a steady WSW breeze
  const ang = 2.6 + (fbm2D(seed * 0.001, 7.7, seed ^ 0x11, 2) - 0.5) * 0.8;
  return {
    texture,
    span: 4096,
    windX: Math.cos(ang),
    windZ: Math.sin(ang),
    windSpeed: 9,
  };
}
