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

// --------------------------------------------------------------- 3D noise
// Period-wrapped 3D primitives for the volumetric-cloud bake: lattice
// coordinates wrap at `period` so the baked texture tiles seamlessly when
// sampled with fract()-wrapped UVs.

function hash3D(x: number, y: number, z: number, seed: number): number {
  let h = seed >>> 0;
  h = Math.imul(h ^ (x | 0), 0x27d4eb2f);
  h = Math.imul(h ^ (y | 0), 0x165667b1);
  h = Math.imul(h ^ (z | 0), 0x85ebca6b);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return (h >>> 0) / 4294967296;
}

const wrap = (i: number, period: number): number => ((i % period) + period) % period;

/** Period-tiling 3D value noise in [0,1). */
export function valueNoise3D(x: number, y: number, z: number, seed: number, period: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const xf = x - xi;
  const yf = y - yi;
  const zf = z - zi;
  const u = smooth(xf);
  const v = smooth(yf);
  const w = smooth(zf);
  let out = 0;
  for (let dz = 0; dz <= 1; dz++) {
    const wz = dz === 0 ? 1 - w : w;
    for (let dy = 0; dy <= 1; dy++) {
      const wy = dy === 0 ? 1 - v : v;
      for (let dx = 0; dx <= 1; dx++) {
        const wx = dx === 0 ? 1 - u : u;
        out +=
          wx *
          wy *
          wz *
          hash3D(wrap(xi + dx, period), wrap(yi + dy, period), wrap(zi + dz, period), seed);
      }
    }
  }
  return out;
}

/** Period-tiling 3D fBm in [0,1). Period doubles with frequency so every octave tiles. */
export function fbm3D(
  x: number,
  y: number,
  z: number,
  seed: number,
  period: number,
  octaves = 4,
  gain = 0.55,
): number {
  let amp = 1;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * valueNoise3D(x * freq, y * freq, z * freq, seed + i * 1013, period * freq);
    norm += amp;
    amp *= gain;
    freq *= 2;
  }
  return norm > 0 ? sum / norm : 0;
}

/** Period-tiling 3D Worley (cellular) noise — normalized F1 distance in [0,1]. */
export function worley3D(x: number, y: number, z: number, seed: number, period: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  let best = 9;
  for (let dz = -1; dz <= 1; dz++) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const cx = xi + dx;
        const cy = yi + dy;
        const cz = zi + dz;
        const wx = wrap(cx, period);
        const wy = wrap(cy, period);
        const wz = wrap(cz, period);
        const fx = cx + hash3D(wx, wy, wz, seed);
        const fy = cy + hash3D(wx, wy, wz, seed ^ 0x9e3779b9);
        const fz = cz + hash3D(wx, wy, wz, seed ^ 0x517cc1b7);
        const ddx = fx - x;
        const ddy = fy - y;
        const ddz = fz - z;
        const d = ddx * ddx + ddy * ddy + ddz * ddz;
        if (d < best) best = d;
      }
    }
  }
  return Math.min(1, Math.sqrt(best));
}
