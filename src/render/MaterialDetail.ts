/**
 * Photoreal procedural surface materials. Two TSL node graphs per material:
 *
 *  - colorNode: a detail MULTIPLIER around 1.0 (NodeMaterial multiplies it by
 *    vertexColor + instanceColor, so existing painting/tints keep working). It
 *    adds macro/meso/micro frequency bands plus per-class structure (stone
 *    coursing, roof tiles, plank grain, gravel).
 *  - normalNode: procedural BUMP mapping — a per-class height field turned into
 *    a perturbed normal via bumpMap() (screen-space derivative of the height).
 *    This is what makes flat walls / ground catch the low sun with real relief
 *    (mortar grooves recessed, stones proud, roof tiles lipped, gravel bumpy)
 *    instead of reading as painted-flat game surfaces.
 *  - roughnessNode: micro variance so highlights never read plastic.
 */

import { MeshStandardNodeMaterial } from 'three/webgpu';
import {
  Fn,
  abs,
  bumpMap,
  clamp,
  dot,
  float,
  floor,
  fract,
  max,
  mix,
  positionWorld,
  sin,
  smoothstep,
  vec2,
  vec3,
} from 'three/tsl';
import { DoubleSide } from 'three';

type N2 = ReturnType<typeof vec2>;
type NF = ReturnType<typeof float>;

const hash12 = (p: N2): NF =>
  fract(sin(dot(p, vec2(127.1, 311.7))).mul(43758.5453)) as unknown as NF;

/** 2D value noise in [0,1), smooth interpolation. */
const vnoise = (p: N2): NF => {
  const i = floor(p);
  const f = fract(p);
  const u = f.mul(f).mul(f.mul(-2).add(3));
  const a = hash12(i as unknown as N2);
  const b = hash12(i.add(vec2(1, 0)) as unknown as N2);
  const c = hash12(i.add(vec2(0, 1)) as unknown as N2);
  const d = hash12(i.add(vec2(1, 1)) as unknown as N2);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y) as unknown as NF;
};

/** 3-octave fbm for richer height fields. */
const fbm = (p: N2): NF => {
  const a = vnoise(p);
  const b = vnoise(p.mul(2.03).add(11.7) as unknown as N2).mul(0.5);
  const c = vnoise(p.mul(4.01).add(37.1) as unknown as N2).mul(0.25);
  return a.add(b).add(c).div(1.75) as unknown as NF;
};

export type DetailKind =
  | 'terrain'
  | 'road'
  | 'masonry'
  | 'roof'
  | 'wood'
  | 'stone'
  | 'soil'
  | 'foliage'
  | 'grass'
  | 'metal';

export interface DetailOptions {
  roughness: number;
  metalness?: number;
  doubleSide?: boolean;
}

// Per-class bump strength (how deep the relief reads). 0 disables.
const BUMP: Record<DetailKind, number> = {
  masonry: 5.5,
  stone: 5.5,
  roof: 4.0,
  wood: 2.4,
  road: 3.0,
  soil: 3.0,
  terrain: 1.6,
  grass: 0,
  foliage: 0,
  metal: 0.8,
};

export function detailedMaterial(kind: DetailKind, opts: DetailOptions): MeshStandardNodeMaterial {
  const mat = new MeshStandardNodeMaterial({
    roughness: opts.roughness,
    metalness: opts.metalness ?? 0,
  });
  mat.vertexColors = true;
  if (opts.doubleSide) mat.side = DoubleSide;

  const isGroundKind = kind === 'terrain' || kind === 'road' || kind === 'soil' || kind === 'grass';

  const detail = Fn(() => {
    const wp = positionWorld;
    const ground = vec2(wp.x, wp.z);
    // wall-friendly plane: horizontal position folded with height so vertical
    // surfaces vary along BOTH axes regardless of orientation
    const wall = vec2(wp.x.add(wp.z), wp.y.mul(1.25));

    const macro = vnoise(ground.div(9.3) as unknown as N2).sub(0.5).mul(0.16).add(1);
    const meso = vnoise((isGroundKind ? ground : wall).div(1.42) as unknown as N2).sub(0.5).mul(0.13).add(1);
    const micro = vnoise((isGroundKind ? ground : wall).div(0.21) as unknown as N2).sub(0.5).mul(0.1).add(1);

    let k: NF = macro.mul(meso).mul(micro) as unknown as NF;

    if (kind === 'masonry' || kind === 'stone') {
      const course = wp.y.div(0.4);
      const row = floor(course);
      const hEdge = abs(fract(course).sub(0.5)).mul(2);
      const hMortar = smoothstep(0.8, 0.99, hEdge);
      const offset = row.mod(2).mul(0.5);
      const colU = wp.x.add(wp.z).div(0.62).add(offset);
      const vEdge = abs(fract(colU).sub(0.5)).mul(2);
      const vMortar = smoothstep(0.84, 0.99, vEdge);
      const mortar = hMortar.max(vMortar);
      const perStone = hash12(vec2(row, floor(colU)) as unknown as N2).mul(0.19).add(0.9);
      k = k.mul(mix(float(1), float(0.62), mortar)).mul(perStone) as unknown as NF;
    } else if (kind === 'roof') {
      const tileCell = vec2(floor(wp.x.add(wp.z).div(0.44)), floor(wp.y.div(0.27)));
      k = k.mul(hash12(tileCell as unknown as N2).mul(0.17).add(0.915)) as unknown as NF;
    } else if (kind === 'wood') {
      const grain = vnoise(vec2(wp.x.add(wp.z).div(0.07), wp.y.div(1.6)) as unknown as N2);
      k = k.mul(grain.sub(0.5).mul(0.14).add(1)) as unknown as NF;
    } else if (kind === 'road') {
      const speckle = hash12(vec2(floor(wp.x.mul(7.3)), floor(wp.z.mul(7.3))) as unknown as N2);
      const pebble = hash12(vec2(floor(wp.x.mul(23.0)), floor(wp.z.mul(23.0))) as unknown as N2);
      k = k.mul(speckle.mul(0.22).add(0.89)).mul(pebble.mul(0.14).add(0.93)) as unknown as NF;
    } else if (kind === 'soil') {
      const clod = vnoise(ground.div(0.45) as unknown as N2);
      k = k.mul(clod.sub(0.5).mul(0.16).add(1)) as unknown as NF;
    } else if (kind === 'foliage' || kind === 'grass') {
      const leaf = vnoise((kind === 'grass' ? ground : wall).div(0.5) as unknown as N2);
      k = k.mul(leaf.sub(0.5).mul(0.18).add(1)) as unknown as NF;
    }

    return vec3(k, k, k);
  })();

  mat.colorNode = detail;

  // ---- procedural height → bump normal (the photoreal relief) --------------
  const bumpAmt = BUMP[kind];
  if (bumpAmt > 0) {
    const height = Fn(() => {
      const wp = positionWorld;
      const ground = vec2(wp.x, wp.z);
      const wall = vec2(wp.x.add(wp.z), wp.y.mul(1.25));
      const uv = isGroundKind ? ground : wall;
      let h: NF = fbm(uv.div(0.5) as unknown as N2).mul(0.1).add(0.5) as unknown as NF; // base micro

      if (kind === 'masonry' || kind === 'stone') {
        const course = wp.y.div(0.4);
        const row = floor(course);
        const hEdge = abs(fract(course).sub(0.5)).mul(2);
        const hMortar = smoothstep(0.78, 1.0, hEdge);
        const offset = row.mod(2).mul(0.5);
        const colU = wp.x.add(wp.z).div(0.62).add(offset);
        const vEdge = abs(fract(colU).sub(0.5)).mul(2);
        const vMortar = smoothstep(0.82, 1.0, vEdge);
        const mortar = max(hMortar, vMortar);
        // stones proud & gently domed, mortar recessed, rough stone face noise
        const domeU = abs(fract(colU).sub(0.5)).oneMinus();
        const domeV = abs(fract(course).sub(0.5)).oneMinus();
        const perStone = hash12(vec2(row, floor(colU)) as unknown as N2).mul(0.22);
        h = float(0.72)
          .sub(mortar.mul(0.7))
          .add(domeU.mul(domeV).mul(0.14))
          .add(perStone)
          .add(fbm(wall.div(0.09) as unknown as N2).mul(0.12)) as unknown as NF;
      } else if (kind === 'roof') {
        // overlapping tiles: a proud lip at the lower edge of every course
        const rowY = wp.y.div(0.27);
        const lip = smoothstep(0.0, 0.32, fract(rowY));
        const tileCell = vec2(floor(wp.x.add(wp.z).div(0.44)), floor(rowY));
        h = float(0.45)
          .add(lip.mul(0.32))
          .add(hash12(tileCell as unknown as N2).mul(0.12))
          .add(vnoise(wall.div(0.08) as unknown as N2).mul(0.05)) as unknown as NF;
      } else if (kind === 'wood') {
        const plank = fract(wp.x.add(wp.z).div(0.28));
        const groove = smoothstep(0.0, 0.09, plank).mul(smoothstep(1.0, 0.91, plank));
        h = float(0.5)
          .add(groove.mul(0.2))
          .add(vnoise(vec2(wp.x.add(wp.z).div(0.05), wp.y.div(1.4)) as unknown as N2).mul(0.12)) as unknown as NF;
      } else if (kind === 'road') {
        const pebble = hash12(vec2(floor(wp.x.mul(23.0)), floor(wp.z.mul(23.0))) as unknown as N2);
        h = fbm(ground.div(0.22) as unknown as N2).mul(0.55).add(pebble.mul(0.3)) as unknown as NF;
      } else if (kind === 'soil') {
        h = fbm(ground.div(0.4) as unknown as N2).mul(0.6).add(vnoise(ground.div(0.11) as unknown as N2).mul(0.2)) as unknown as NF;
      } else if (kind === 'terrain') {
        h = fbm(ground.div(0.6) as unknown as N2).mul(0.5) as unknown as NF;
      } else if (kind === 'metal') {
        h = vnoise(wall.div(0.9) as unknown as N2).mul(0.4).add(0.3) as unknown as NF;
      }
      return h;
    })();
    mat.normalNode = bumpMap(height as unknown as N2, float(bumpAmt));
  }

  // micro-driven roughness variance keeps highlights from reading plastic
  const rBase = opts.roughness;
  const wpr = positionWorld;
  const rough = vnoise(vec2(wpr.x.add(wpr.z), wpr.y.add(wpr.z)).div(0.33) as unknown as N2)
    .sub(0.5)
    .mul(0.16)
    .add(rBase);
  mat.roughnessNode = clamp(rough, 0.3, 1.0);

  return mat;
}
