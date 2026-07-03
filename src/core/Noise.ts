/**
 * Deterministic CPU value noise + fBm used by terrain, scatter and material
 * generators. Seeded explicitly — never Math.random — so ?seed=N reproduces
 * the world exactly.
 */

import { hash2D } from './Random.ts';

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

/** Value noise in [0,1). */
export function valueNoise2D(x: number, y: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const a = hash2D(xi, yi, seed);
  const b = hash2D(xi + 1, yi, seed);
  const c = hash2D(xi, yi + 1, seed);
  const d = hash2D(xi + 1, yi + 1, seed);
  const u = smooth(xf);
  const v = smooth(yf);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/** Fractal Brownian motion in [0,1) with given octaves. */
export function fbm2D(x: number, y: number, seed: number, octaves = 4, lacunarity = 2, gain = 0.5): number {
  let amp = 0.5;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * valueNoise2D(x * freq, y * freq, seed + i * 1013);
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return norm > 0 ? sum / norm : 0;
}

/** Ridged fBm in [0,1) — sharp crests, used for embankments/ridges. */
export function ridged2D(x: number, y: number, seed: number, octaves = 4): number {
  let amp = 0.5;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    const n = valueNoise2D(x * freq, y * freq, seed + i * 733);
    sum += amp * (1 - Math.abs(n * 2 - 1));
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return norm > 0 ? sum / norm : 0;
}

/** Domain-warped fbm for organic field/patch masks. */
export function warped2D(x: number, y: number, seed: number, warp = 1.5, octaves = 4): number {
  const wx = fbm2D(x * 0.7 + 13.1, y * 0.7, seed + 555, 3) * warp;
  const wy = fbm2D(x * 0.7, y * 0.7 + 71.7, seed + 999, 3) * warp;
  return fbm2D(x + wx, y + wy, seed, octaves);
}
