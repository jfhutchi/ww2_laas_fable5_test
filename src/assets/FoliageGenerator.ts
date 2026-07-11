/**
 * FoliageGenerator — structured, wind-animated instanced trees and bushes.
 *
 * Mechanism (LAAS TreeBuilder/Skeleton approach, simplified to two branch
 * levels): every tree is grown from a wandering trunk centerline; primary
 * branches loft up/outward with cantilever droop and tip curl; secondaries
 * split off the primaries; displaced-icosphere leaf clusters hang at branch
 * tips and along secondaries, so crowns read lumpy and asymmetric with real
 * gaps instead of one blob. All limbs are parallel-transport tube lofts with
 * radial bark noise and baked vertex colour.
 *
 * Instancing architecture kept: per (kind x archetype x part) InstancedMesh
 * with instanceColor variation. Because hedgerow oaks number ~2000, each
 * kind's 3 archetypes are built at tiered quality (hero ~10k tris / mid /
 * field) and instances are routed to tiers by a deterministic weighted hash,
 * keeping the whole pass under ~2.5M triangles on 'high' at <= 24 draws.
 *
 * Wind: a per-vertex 'flex' attribute is baked (0 at trunk base -> 1 at
 * branch tips / crown top; leaf clusters >= 0.6). Both materials are
 * MeshStandardNodeMaterial (via detailedMaterial 'wood'/'foliage') with a
 * vertex-stage positionNode: seeded-direction lean (flex^2), per-instance
 * Lissajous sway (hash(instanceIndex) phase/frequency), and high-frequency
 * flutter — amplitudes <= ~0.2 m at tips. Shadows inherit positionNode.
 * Fully deterministic from model.seed.
 */

import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Quaternion,
  Vector2,
  Vector3,
} from 'three';
import type { MeshStandardNodeMaterial } from 'three/webgpu';
import { attribute, float, hash, instanceIndex, positionLocal, time, uniform, vec2, vec3 } from 'three/tsl';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import type { GraphicsPreset } from '../app/Config.ts';
import { clamp01, lerp } from '../core/MathUtil.ts';
import { fbm2D } from '../core/Noise.ts';
import { hash2D, Rng } from '../core/Random.ts';
import { detailedMaterial } from '../render/MaterialDetail.ts';
import type { Ground } from '../world/Ground.ts';
import type { PropKind, PropSpec, WorldModel } from '../world/WorldTypes.ts';

// ------------------------------------------------------------------- types

type FoliageKind = Extract<PropKind, 'tree-oak' | 'tree-poplar' | 'tree-apple' | 'bush'>;

const FOLIAGE_KINDS: readonly FoliageKind[] = ['tree-oak', 'tree-poplar', 'tree-apple', 'bush'];

/** Canopy base tints (kept mid/desaturated so instance multipliers can push
 *  both toward fresh green and toward dry tan). */
const TINT: Record<FoliageKind, readonly [number, number, number]> = {
  'tree-oak': [0.41, 0.47, 0.3],
  'tree-poplar': [0.43, 0.5, 0.3],
  'tree-apple': [0.42, 0.51, 0.31],
  bush: [0.44, 0.49, 0.29],
};

const BARK_R = 0.34;
const BARK_G = 0.29;
const BARK_B = 0.24;
const MOSS_R = 0.3;
const MOSS_G = 0.33;
const MOSS_B = 0.19;

const UP = new Vector3(0, 1, 0);
const X_AXIS = new Vector3(1, 0, 0);
const SEED_MAX = 0x7fffffff;

interface Archetype {
  bark: BufferGeometry;
  canopy: BufferGeometry;
  /** How far the trunk base sinks below the terrain sample (× instance scale). */
  sink: number;
}

// ---------------------------------------------------------- wind materials

type NF = ReturnType<typeof float>;
type N2 = ReturnType<typeof vec2>;

/**
 * Vertex-stage sway: lean + Lissajous sway + flutter along a seeded wind
 * direction, amplitude driven by the baked 'flex' attribute. Pure expression
 * chain (no Fn stack) so the same nodes serve the shadow depth pass.
 */
function applyWind(mat: MeshStandardNodeMaterial, windDir: N2): void {
  const flex = attribute('flex', 'float') as unknown as NF;
  const f2 = flex.mul(flex);
  const ph = hash(instanceIndex) as unknown as NF;
  const phase = ph.mul(6.2832);
  const freq = ph.mul(0.4).add(0.5);

  // static lean downwind + slow rocking (second axis at 1.31x = Lissajous)
  const lean = f2.mul(0.18);
  const sway = time.mul(freq).add(phase).sin().mul(f2).mul(0.12);
  const swayP = time.mul(freq.mul(1.31)).add(phase.mul(1.7)).sin().mul(f2).mul(0.084);

  // leaf flutter: fast, decorrelated along the plant by local position
  const flut = time.mul(3.7).add(positionLocal.y.mul(2.1)).add(phase).sin().mul(flex).mul(0.03);
  const flutP = time.mul(4.3).add(positionLocal.x.mul(1.7)).add(phase.mul(2.3)).sin().mul(flex).mul(0.018);

  const along = lean.add(sway).add(flut);
  const across = swayP.add(flutP);
  // slight cantilever dip so deflected tips arc instead of shearing
  const dip = along.abs().add(across.abs()).mul(flex).mul(-0.1);

  const offset = vec3(
    windDir.x.mul(along).sub(windDir.y.mul(across)),
    dip,
    windDir.y.mul(along).add(windDir.x.mul(across)),
  );
  mat.positionNode = positionLocal.add(offset);
}

interface FoliageMaterials {
  bark: MeshStandardNodeMaterial;
  leaf: MeshStandardNodeMaterial;
}

/** Two shared node materials (bark, leaf) with a seeded wind direction. */
function makeFoliageMaterials(seed: number): FoliageMaterials {
  const ang = new Rng((seed ^ 0x33d17b) >>> 0).range(0, Math.PI * 2);
  const dirU = uniform(new Vector2(Math.cos(ang), Math.sin(ang)));
  const windDir = vec2(dirU as unknown as N2) as unknown as N2;
  const bark = detailedMaterial('bark', { roughness: 0.94 });
  const leaf = detailedMaterial('foliage', { roughness: 0.9 });
  applyWind(bark, windDir);
  applyWind(leaf, windDir);
  return { bark, leaf };
}

// ----------------------------------------------------------------- helpers

function foliageKind(kind: PropKind): FoliageKind | null {
  switch (kind) {
    case 'tree-oak':
    case 'tree-poplar':
    case 'tree-apple':
    case 'bush':
      return kind;
    default:
      return null;
  }
}

/** Cheap deterministic 3D noise in [0,1) from two 2D fBm slices. */
function fbm3(x: number, y: number, z: number, seed: number, octaves = 3): number {
  const a = fbm2D(x + y * 0.41, z - y * 0.23, seed >>> 0, octaves);
  const b = fbm2D(y + z * 0.37, x + z * 0.19, (seed ^ 0x3ab7) >>> 0, octaves);
  return (a + b) * 0.5;
}

/** Position-keyed hash jitter in [0,1) — stable across shared vertices. */
function vertexHash(x: number, y: number, z: number, seed: number): number {
  return hash2D(Math.round(x * 57.31), Math.round(y * 91.7 + z * 57.13), seed >>> 0);
}

function positions(geo: BufferGeometry): BufferAttribute {
  const attr = geo.getAttribute('position');
  if (!attr) throw new Error('foliage geometry missing positions');
  return attr as BufferAttribute;
}

/** Merge helper that tolerates a single-entry list and never returns null. */
function merged(parts: BufferGeometry[]): BufferGeometry {
  const first = parts[0];
  if (parts.length === 1 && first) return first;
  const g = mergeGeometries(parts, false);
  if (!g) throw new Error('foliage geometry merge failed');
  return g;
}

/** Small whole-tree lean applied identically to both parts. */
function tilt(geos: readonly BufferGeometry[], dir: number, angle: number): void {
  if (angle === 0) return;
  const axis = new Vector3(Math.cos(dir), 0, Math.sin(dir));
  const m = new Matrix4().makeRotationAxis(axis, angle);
  for (const g of geos) g.applyMatrix4(m);
}

/** Stable right-handed basis perpendicular to dir (N, B = dir x N). */
function perpBasis(dir: Vector3, outN: Vector3, outB: Vector3): void {
  const ref = Math.abs(dir.y) < 0.94 ? UP : X_AXIS;
  outN.crossVectors(ref, dir).normalize();
  outB.crossVectors(dir, outN).normalize();
}

interface Polyline {
  pts: Vector3[];
  dirs: Vector3[];
}

interface WalkOpts {
  /** Lateral wander amplitude per step (radians-ish). */
  wander: number;
  /** Cantilever droop toward the tip. */
  droop: number;
  /** Late tip curl back upward. */
  curl: number;
  /** Constant upward pull per unit t. */
  upBias: number;
}

/** Grow a branch centerline segment by segment (Skeleton.ts approach). */
function walk(rng: Rng, start: Vector3, dir0: Vector3, len: number, nSeg: number, o: WalkOpts): Polyline {
  const pts: Vector3[] = [start.clone()];
  const dirs: Vector3[] = [];
  const dir = dir0.clone().normalize();
  dirs.push(dir.clone());
  const pos = start.clone();
  const step = len / nSeg;
  const phaseA = rng.range(0, Math.PI * 2);
  const fq = rng.range(1.2, 2.6);
  const N = new Vector3();
  const B = new Vector3();
  for (let i = 1; i <= nSeg; i++) {
    const t = i / nSeg;
    perpBasis(dir, N, B);
    const a1 = Math.sin(t * fq * Math.PI * 2 + phaseA) * o.wander + rng.range(-0.5, 0.5) * o.wander;
    const a2 = Math.cos(t * fq * Math.PI * 1.7 + phaseA * 1.7) * o.wander + rng.range(-0.5, 0.5) * o.wander;
    dir.addScaledVector(N, a1).addScaledVector(B, a2);
    dir.y -= o.droop * t * (2.2 / nSeg);
    if (t > 0.6) dir.y += o.curl * (5 / nSeg) * (t - 0.6);
    dir.y += o.upBias / nSeg;
    dir.normalize();
    pos.addScaledVector(dir, step * rng.range(0.92, 1.08));
    pts.push(pos.clone());
    dirs.push(dir.clone());
  }
  return { pts, dirs };
}

/** Interpolated point/tangent at t in [0,1] along a polyline. */
function sampleLine(line: Polyline, t: number): { pos: Vector3; dir: Vector3 } {
  const n = line.pts.length;
  const f = clamp01(t) * (n - 1);
  const i0 = Math.min(n - 2, Math.floor(f));
  const k = f - i0;
  const p0 = line.pts[i0] as Vector3;
  const p1 = line.pts[i0 + 1] as Vector3;
  const d0 = line.dirs[i0] as Vector3;
  const d1 = line.dirs[i0 + 1] as Vector3;
  return {
    pos: new Vector3().lerpVectors(p0, p1, k),
    dir: new Vector3().lerpVectors(d0, d1, k).normalize(),
  };
}

// -------------------------------------------------------------- tube limbs

interface TubeOpts {
  seed: number;
  line: Polyline;
  rBase: number;
  rTip: number;
  radial: number;
  /** Radial vertex noise amplitude in meters — no perfect tubes. */
  noiseAmp: number;
  /** Root flare strength at the base (0 = none). */
  flare: number;
  flexBase: number;
  flexTip: number;
}

/**
 * Parallel-transport tube loft along a polyline with a cone-capped tip,
 * per-vertex 'flex' ramp and baked bark colour. Winding is CCW-outward
 * (ring triangles a,b,c2 / b,d,c2 for right-handed frames B = T x N —
 * verified numerically: dot(normal, radialDir) > 0.9).
 */
function makeTube(o: TubeOpts): BufferGeometry {
  const n = o.line.pts.length;
  const K = o.radial;
  const count = n * K + 1;
  const posArr = new Float32Array(count * 3);
  const flexArr = new Float32Array(count);

  const T = new Vector3();
  const rn = new Vector3();
  const B = new Vector3();
  perpBasis(o.line.dirs[0] as Vector3, rn, B);
  const v = new Vector3();

  for (let i = 0; i < n; i++) {
    T.copy(o.line.dirs[i] as Vector3).normalize();
    // parallel transport of the ring normal: strip the tangent component
    rn.addScaledVector(T, -rn.dot(T));
    if (rn.lengthSq() < 1e-8) perpBasis(T, rn, B);
    rn.normalize();
    B.crossVectors(T, rn).normalize();

    const t = i / (n - 1);
    const rr = Math.max(0.008, lerp(o.rBase, o.rTip, Math.pow(t, 0.85))) * (1 + o.flare * Math.pow(1 - t, 3));
    const fx = lerp(o.flexBase, o.flexTip, Math.pow(t, 1.35));
    const c = o.line.pts[i] as Vector3;
    for (let j = 0; j < K; j++) {
      const ang = (j / K) * Math.PI * 2;
      const noise = (fbm3(c.x * 2.6 + Math.cos(ang) * 1.7, c.y * 1.15 + j * 0.61, c.z * 2.6 + Math.sin(ang) * 1.7, o.seed, 2) * 2 - 1) * o.noiseAmp;
      const r = Math.max(0.006, rr + noise);
      v.copy(c).addScaledVector(rn, Math.cos(ang) * r).addScaledVector(B, Math.sin(ang) * r);
      const vi = i * K + j;
      posArr[vi * 3] = v.x;
      posArr[vi * 3 + 1] = v.y;
      posArr[vi * 3 + 2] = v.z;
      flexArr[vi] = fx;
    }
  }

  // cone tip
  const lastP = o.line.pts[n - 1] as Vector3;
  const lastD = o.line.dirs[n - 1] as Vector3;
  const tipLen = Math.max(0.02, o.rTip * 1.8);
  const ti = n * K;
  posArr[ti * 3] = lastP.x + lastD.x * tipLen;
  posArr[ti * 3 + 1] = lastP.y + lastD.y * tipLen;
  posArr[ti * 3 + 2] = lastP.z + lastD.z * tipLen;
  flexArr[ti] = o.flexTip;

  const idx: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < K; j++) {
      const j2 = (j + 1) % K;
      const a = i * K + j;
      const b = i * K + j2;
      const c2 = (i + 1) * K + j;
      const d = (i + 1) * K + j2;
      idx.push(a, b, c2, b, d, c2);
    }
  }
  for (let j = 0; j < K; j++) {
    const j2 = (j + 1) % K;
    idx.push((n - 1) * K + j, (n - 1) * K + j2, ti);
  }

  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(posArr, 3));
  geo.setAttribute('flex', new BufferAttribute(flexArr, 1));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  bakeBark(geo, o.seed);
  return geo;
}

/** Bark colour: brown-grey base, vertical streaks, mossy darker feet. */
function bakeBark(geo: BufferGeometry, seed: number): void {
  const pos = positions(geo);
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const px = pos.getX(i);
    const py = pos.getY(i);
    const pz = pos.getZ(i);
    const streak = fbm3(px * 2.7, py * 1.35, pz * 2.7, (seed ^ 0xb0b) >>> 0, 2);
    const grain = vertexHash(px, py, pz, seed ^ 0x1d0f);
    const hFade = clamp01(py / 1.4);
    const val = (0.82 + 0.36 * streak) * (0.93 + 0.14 * grain) * lerp(0.8, 1.04, hFade);
    const moss = (1 - hFade) * 0.45 * grain;
    colors[i * 3] = lerp(BARK_R, MOSS_R, moss) * val;
    colors[i * 3 + 1] = lerp(BARK_G, MOSS_G, moss) * val;
    colors[i * 3 + 2] = lerp(BARK_B, MOSS_B, moss) * val;
  }
  geo.setAttribute('color', new BufferAttribute(colors, 3));
}

// -------------------------------------------------------------- leaf blobs

interface BlobOpts {
  seed: number;
  detail: number;
  /** Radial displacement amplitude (fraction of radius, ±). */
  amp: number;
  freq: number;
  sx: number;
  sy: number;
  sz: number;
  x: number;
  y: number;
  z: number;
  rotY: number;
  tintR: number;
  tintG: number;
  tintB: number;
  /** Per-blob value variation baked into the archetype. */
  value: number;
  /** Wind flex at the cluster centre (clamped to >= 0.6 for leaves). */
  flexBase: number;
}

/** One displaced icosphere foliage cluster with baked colour + flex. */
function makeBlob(o: BlobOpts): BufferGeometry {
  const raw = new IcosahedronGeometry(1, o.detail);
  raw.deleteAttribute('uv');
  raw.deleteAttribute('normal');
  const geo = mergeVertices(raw, 1e-4);

  const pos = positions(geo);
  const flex = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const px = pos.getX(i);
    const py = pos.getY(i);
    const pz = pos.getZ(i);
    const n = fbm3(px * o.freq + 11.7, py * o.freq + 3.9, pz * o.freq - 5.3, o.seed);
    const r = 1 + o.amp * (n * 2 - 1);
    pos.setXYZ(i, px * r, py * r, pz * r);
    // crown-top vertices flex a touch more; jitter decorrelates leaves
    const jit = vertexHash(px * 3.1, py * 3.1, pz * 3.1, o.seed ^ 0x5afe);
    const f = o.flexBase + py * 0.07 + jit * 0.05;
    flex[i] = f < 0.6 ? 0.6 : f > 1 ? 1 : f;
  }
  const m = new Matrix4()
    .makeTranslation(o.x, o.y, o.z)
    .multiply(new Matrix4().makeRotationY(o.rotY))
    .multiply(new Matrix4().makeScale(o.sx, o.sy, o.sz));
  geo.applyMatrix4(m);
  geo.computeVertexNormals();

  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const jit = 0.9 + 0.22 * vertexHash(pos.getX(i), pos.getY(i), pos.getZ(i), o.seed ^ 0x77c1);
    const val = o.value * jit;
    colors[i * 3] = o.tintR * val;
    colors[i * 3 + 1] = o.tintG * val;
    colors[i * 3 + 2] = o.tintB * val;
  }
  geo.setAttribute('color', new BufferAttribute(colors, 3));
  geo.setAttribute('flex', new BufferAttribute(flex, 1));
  return geo;
}

/** Darken canopy undersides / interiors, lift the sun-facing crown. */
function applyCanopyShading(geo: BufferGeometry, dark: number, light: number): void {
  const pos = positions(geo);
  const color = geo.getAttribute('color') as BufferAttribute | undefined;
  if (!color) return;
  let yMin = Infinity;
  let yMax = -Infinity;
  let cx = 0;
  let cz = 0;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    yMin = Math.min(yMin, y);
    yMax = Math.max(yMax, y);
    cx += pos.getX(i);
    cz += pos.getZ(i);
  }
  const n = Math.max(1, pos.count);
  cx /= n;
  cz /= n;
  let dMax = 1e-6;
  for (let i = 0; i < pos.count; i++) {
    dMax = Math.max(dMax, Math.hypot(pos.getX(i) - cx, pos.getZ(i) - cz));
  }
  const span = Math.max(1e-6, yMax - yMin);
  for (let i = 0; i < pos.count; i++) {
    const t = (pos.getY(i) - yMin) / span;
    const st = t * t * (3 - 2 * t);
    const rim = lerp(0.84, 1.02, clamp01(Math.hypot(pos.getX(i) - cx, pos.getZ(i) - cz) / dMax));
    const mul = lerp(dark, light, st) * rim;
    color.setXYZ(i, color.getX(i) * mul, color.getY(i) * mul, color.getZ(i) * mul);
  }
}

/** Cluster centre wind-flex from its relative height in the tree. */
function clusterFlex(y: number, totalH: number, rng: Rng): number {
  const f = 0.6 + 0.32 * clamp01(y / Math.max(1e-3, totalH)) + rng.range(-0.02, 0.05);
  return f > 0.98 ? 0.98 : f < 0.6 ? 0.6 : f;
}

// --------------------------------------------------------- quality tiers

interface LimbQ {
  radial: number;
  segs: number;
}

interface OakQ {
  nPrimary: readonly [number, number];
  nSecondary: readonly [number, number];
  trunk: LimbQ;
  primary: LimbQ;
  secondary: LimbQ;
  /** Icosphere detail for primary-tip clusters (three: 20*(d+1)^2 tris). */
  tipDetail: number;
  /** Detail for secondary-tip / along clusters. */
  secDetail: number;
  /** Chance of an extra cluster mid-secondary. */
  alongChance: number;
  /** Inner crown filler blobs. */
  filler: number;
  /** Cluster radius multiplier (leaner tiers get bigger, fewer clusters). */
  clusterK: number;
}

/** Tier 0 = hero (~11k tris), 1 = mid (~1.5k), 2 = field (~0.5k). */
const OAK_Q: readonly OakQ[] = [
  { nPrimary: [5, 6], nSecondary: [3, 3], trunk: { radial: 9, segs: 6 }, primary: { radial: 7, segs: 5 }, secondary: { radial: 5, segs: 3 }, tipDetail: 3, secDetail: 3, alongChance: 0.8, filler: 3, clusterK: 1 },
  { nPrimary: [4, 5], nSecondary: [1, 2], trunk: { radial: 7, segs: 4 }, primary: { radial: 5, segs: 3 }, secondary: { radial: 4, segs: 2 }, tipDetail: 1, secDetail: 1, alongChance: 0.3, filler: 1, clusterK: 1.18 },
  { nPrimary: [3, 3], nSecondary: [0, 0], trunk: { radial: 6, segs: 3 }, primary: { radial: 4, segs: 2 }, secondary: { radial: 4, segs: 2 }, tipDetail: 1, secDetail: 1, alongChance: 0, filler: 2, clusterK: 1.34 },
];

interface AppleQ {
  nBranch: readonly [number, number];
  trunk: LimbQ;
  branch: LimbQ;
  tipDetail: number;
  crown: number;
  crownDetail: number;
}

const APPLE_Q: readonly AppleQ[] = [
  { nBranch: [4, 5], trunk: { radial: 7, segs: 5 }, branch: { radial: 5, segs: 3 }, tipDetail: 3, crown: 3, crownDetail: 3 },
  { nBranch: [3, 4], trunk: { radial: 6, segs: 4 }, branch: { radial: 4, segs: 2 }, tipDetail: 2, crown: 1, crownDetail: 1 },
  { nBranch: [3, 3], trunk: { radial: 5, segs: 4 }, branch: { radial: 4, segs: 2 }, tipDetail: 1, crown: 1, crownDetail: 2 },
];

/** Weighted tier assignment per kind: hero trees are rare, field trees are
 *  the bocage mass. Index = archetype index. */
function archWeights(kind: FoliageKind, preset: GraphicsPreset): readonly number[] {
  if (preset === 'low') {
    switch (kind) {
      case 'tree-oak':
        return [0.12, 0.88];
      case 'tree-apple':
        return [0.4, 0.6];
      default:
        return [0.5, 0.5];
    }
  }
  const heroOak = preset === 'ultra' ? 0.03 : 0.02;
  switch (kind) {
    case 'tree-oak':
      return [heroOak, 0.15, 0.85 - heroOak];
    case 'tree-apple':
      return [0.15, 0.45, 0.4];
    default:
      return [0.34, 0.33, 0.33];
  }
}

const ARCH_SALT: Record<FoliageKind, number> = {
  'tree-oak': 0x0aacf3,
  'tree-poplar': 0x1bd5e9,
  'tree-apple': 0x2c33a7,
  bush: 0x3d871b,
};

/** Deterministic weighted archetype pick per prop spec. */
function pickArchetype(spec: PropSpec, weights: readonly number[], salt: number): number {
  const r = hash2D(spec.seed | 0, (spec.id ^ 0x2f) | 0, salt >>> 0);
  let acc = 0;
  for (let i = 0; i < weights.length; i++) {
    acc += weights[i] ?? 0;
    if (r < acc) return i;
  }
  return weights.length - 1;
}

// -------------------------------------------------------------- archetypes

/** Broad hedgerow oak, 7-10 m: trunk + 3-6 primaries + secondaries with
 *  leaf clusters at tips/along secondaries — lumpy asymmetric crown. */
function buildOak(rng: Rng, q: OakQ): Archetype {
  const totalH = rng.range(7, 10);
  const trunkH = totalH * rng.range(0.3, 0.38);
  const rBase = rng.range(0.3, 0.44);
  const hK = totalH / 8.5;
  const leanDir = rng.range(0, Math.PI * 2);
  const asym = rng.range(0.1, 0.26);
  const [tr, tg, tb] = TINT['tree-oak'];

  const trunkLine = walk(
    rng,
    new Vector3(0, -0.45, 0),
    new Vector3(rng.range(-0.07, 0.07), 1, rng.range(-0.07, 0.07)),
    trunkH + 0.45 + rng.range(0.5, 0.9),
    q.trunk.segs,
    { wander: 0.07, droop: 0, curl: 0, upBias: 0.2 },
  );
  const trunkFlexTip = 0.22;
  const barkParts: BufferGeometry[] = [
    makeTube({
      seed: rng.int(1, SEED_MAX),
      line: trunkLine,
      rBase,
      rTip: rBase * 0.4,
      radial: q.trunk.radial,
      noiseAmp: rBase * 0.15,
      flare: rng.range(0.35, 0.6),
      flexBase: 0.02,
      flexTip: trunkFlexTip,
    }),
  ];

  const blobs: BufferGeometry[] = [];
  const blob = (x: number, y: number, z: number, r: number, detail: number): void => {
    blobs.push(
      makeBlob({
        seed: rng.int(1, SEED_MAX),
        detail,
        amp: rng.range(0.28, 0.38),
        freq: rng.range(1.1, 1.7),
        sx: r * rng.range(0.9, 1.15),
        sy: r * rng.range(0.7, 0.9),
        sz: r * rng.range(0.9, 1.15),
        x,
        y,
        z,
        rotY: rng.range(0, Math.PI * 2),
        tintR: tr,
        tintG: tg,
        tintB: tb,
        value: rng.range(0.8, 1.1),
        flexBase: clusterFlex(y, totalH, rng),
      }),
    );
  };

  const nP = rng.int(q.nPrimary[0], q.nPrimary[1]);
  for (let i = 0; i < nP; i++) {
    const az = (i / nP) * Math.PI * 2 + rng.range(-0.5, 0.5);
    const attachT = rng.range(0.62, 0.95);
    const s = sampleLine(trunkLine, attachT);
    const trunkRAt = lerp(rBase, rBase * 0.4, Math.pow(attachT, 0.85));
    const flexAt = lerp(0.02, trunkFlexTip, Math.pow(attachT, 1.35));
    const elev = rng.range(0.55, 1.0);
    const dir0 = new Vector3(Math.cos(az) * Math.sin(elev), Math.cos(elev), Math.sin(az) * Math.sin(elev));
    const asymK = 1 + asym * Math.cos(az - leanDir) * 2;
    const len = rng.range(2.1, 3.2) * hK * asymK;
    const pLine = walk(rng, s.pos, dir0, len, q.primary.segs, {
      wander: 0.13,
      droop: rng.range(0.15, 0.45),
      curl: rng.range(0.1, 0.3),
      upBias: 0,
    });
    const prB = trunkRAt * rng.range(0.55, 0.72);
    barkParts.push(
      makeTube({
        seed: rng.int(1, SEED_MAX),
        line: pLine,
        rBase: prB,
        rTip: 0.035,
        radial: q.primary.radial,
        noiseAmp: prB * 0.16,
        flare: 0,
        flexBase: flexAt,
        flexTip: 0.5,
      }),
    );

    const tip = pLine.pts[pLine.pts.length - 1] as Vector3;
    const tipDir = pLine.dirs[pLine.dirs.length - 1] as Vector3;
    const tipR = rng.range(1.0, 1.4) * q.clusterK * hK;
    blob(tip.x + tipDir.x * tipR * 0.3, tip.y + tipDir.y * tipR * 0.3 + tipR * 0.12, tip.z + tipDir.z * tipR * 0.3, tipR, q.tipDetail);

    const nS = rng.int(q.nSecondary[0], q.nSecondary[1]);
    for (let j = 0; j < nS; j++) {
      const st = rng.range(0.3, 0.8);
      const ss = sampleLine(pLine, st);
      const N = new Vector3();
      const B = new Vector3();
      perpBasis(ss.dir, N, B);
      const psi = rng.range(0, Math.PI * 2);
      const side = new Vector3().addScaledVector(N, Math.cos(psi)).addScaledVector(B, Math.sin(psi));
      const theta = rng.range(0.55, 0.95);
      const cDir = new Vector3()
        .addScaledVector(ss.dir, Math.cos(theta))
        .addScaledVector(side, Math.sin(theta))
        .add(new Vector3(0, 0.22, 0))
        .normalize();
      const sLen = len * rng.range(0.35, 0.55);
      const sLine = walk(rng, ss.pos, cDir, sLen, q.secondary.segs, {
        wander: 0.17,
        droop: rng.range(0.08, 0.28),
        curl: 0.1,
        upBias: 0.1,
      });
      const srB = Math.max(0.02, lerp(prB, 0.035, Math.pow(st, 0.85)) * rng.range(0.5, 0.62));
      barkParts.push(
        makeTube({
          seed: rng.int(1, SEED_MAX),
          line: sLine,
          rBase: srB,
          rTip: 0.016,
          radial: q.secondary.radial,
          noiseAmp: srB * 0.15,
          flare: 0,
          flexBase: lerp(flexAt, 0.5, Math.pow(st, 1.35)),
          flexTip: 0.72,
        }),
      );
      const sTip = sLine.pts[sLine.pts.length - 1] as Vector3;
      blob(sTip.x, sTip.y + rng.range(0, 0.2), sTip.z, rng.range(0.8, 1.1) * q.clusterK * hK, q.secDetail);
      if (rng.chance(q.alongChance)) {
        const mid = sampleLine(sLine, rng.range(0.4, 0.65));
        blob(mid.pos.x, mid.pos.y + rng.range(0.05, 0.25), mid.pos.z, rng.range(0.62, 0.85) * q.clusterK * hK, q.secDetail);
      }
    }
  }

  // inner crown filler hides the leader / trunk-top junction
  for (let k = 0; k < q.filler; k++) {
    const az = rng.range(0, Math.PI * 2);
    const rad = rng.range(0.2, 0.9) * hK;
    const y = trunkH + (totalH - trunkH) * rng.range(0.3, 0.72);
    blob(Math.cos(az) * rad, y, Math.sin(az) * rad, rng.range(0.85, 1.2) * q.clusterK * hK, q.secDetail);
  }

  const bark = merged(barkParts);
  const canopy = merged(blobs);
  applyCanopyShading(canopy, 0.6, 1.14);
  tilt([bark, canopy], rng.range(0, Math.PI * 2), rng.range(0, 0.045));
  return { bark, canopy, sink: 0.35 };
}

/** Tall columnar poplar, 11-14 m: visible trunk + 6-9 stacked clusters. */
function buildPoplar(rng: Rng, rich: boolean): Archetype {
  const totalH = rng.range(11, 14);
  const rBase = rng.range(0.2, 0.28);
  const [tr, tg, tb] = TINT['tree-poplar'];

  const trunkLine = walk(
    rng,
    new Vector3(0, -0.4, 0),
    new Vector3(rng.range(-0.035, 0.035), 1, rng.range(-0.035, 0.035)),
    totalH * 0.88 + 0.4,
    rich ? 5 : 4,
    { wander: 0.035, droop: 0, curl: 0, upBias: 0.12 },
  );
  const barkParts: BufferGeometry[] = [
    makeTube({
      seed: rng.int(1, SEED_MAX),
      line: trunkLine,
      rBase,
      rTip: rBase * 0.24,
      radial: rich ? 8 : 6,
      noiseAmp: rBase * 0.12,
      flare: rng.range(0.3, 0.5),
      flexBase: 0.02,
      flexTip: 0.34,
    }),
  ];
  // short steep stub branches anchoring the lower crown to the trunk
  const nStub = rich ? 3 : 1;
  for (let i = 0; i < nStub; i++) {
    const at = rng.range(0.4, 0.75);
    const s = sampleLine(trunkLine, at);
    const az = rng.range(0, Math.PI * 2);
    const elev = rng.range(0.3, 0.5);
    const dir0 = new Vector3(Math.cos(az) * Math.sin(elev), Math.cos(elev), Math.sin(az) * Math.sin(elev));
    const stub = walk(rng, s.pos, dir0, rng.range(0.5, 0.95), 2, { wander: 0.1, droop: 0.05, curl: 0, upBias: 0.2 });
    barkParts.push(
      makeTube({
        seed: rng.int(1, SEED_MAX),
        line: stub,
        rBase: rBase * rng.range(0.22, 0.3),
        rTip: 0.014,
        radial: 4,
        noiseAmp: 0.008,
        flare: 0,
        flexBase: lerp(0.02, 0.34, Math.pow(at, 1.35)),
        flexTip: 0.55,
      }),
    );
  }

  const nBlob = rich ? rng.int(6, 9) : rng.int(5, 6);
  const detail = rich ? 3 : 1;
  const y0 = totalH * 0.18;
  const y1 = totalH * 0.99;
  const maxW = rng.range(1.05, 1.45);
  const blobs: BufferGeometry[] = [];
  for (let k = 0; k < nBlob; k++) {
    const f = nBlob > 1 ? k / (nBlob - 1) : 0.5;
    const y = lerp(y0, y1, f) + rng.range(-0.2, 0.2);
    const spineT = clamp01((y + 0.4) / (totalH * 0.88 + 0.4));
    const spine = sampleLine(trunkLine, spineT);
    const w = maxW * (0.6 + 0.4 * Math.sin(Math.PI * (0.12 + 0.8 * f))) * (1 - 0.3 * f);
    const sy = ((y1 - y0) / nBlob) * rng.range(1.2, 1.45);
    blobs.push(
      makeBlob({
        seed: rng.int(1, SEED_MAX),
        detail,
        amp: rng.range(0.16, 0.24),
        freq: rng.range(1.5, 2.1),
        sx: w * rng.range(0.9, 1.08),
        sy: Math.max(sy, w * 1.25),
        sz: w * rng.range(0.88, 1.05),
        x: spine.pos.x + rng.range(-0.14, 0.14),
        y,
        z: spine.pos.z + rng.range(-0.14, 0.14),
        rotY: rng.range(0, Math.PI * 2),
        tintR: tr,
        tintG: tg,
        tintB: tb,
        value: rng.range(0.85, 1.06),
        flexBase: 0.6 + 0.36 * f,
      }),
    );
  }

  const bark = merged(barkParts);
  const canopy = merged(blobs);
  applyCanopyShading(canopy, 0.68, 1.12);
  tilt([bark, canopy], rng.range(0, Math.PI * 2), rng.range(0.025, 0.075));
  return { bark, canopy, sink: 0.3 };
}

/** Low gnarled orchard apple, 3.5-4.5 m: 2-bend trunk, 3-5 short branches,
 *  round crown clusters at branch tips. */
function buildApple(rng: Rng, q: AppleQ): Archetype {
  const totalH = rng.range(3.5, 4.5);
  const trunkH = rng.range(1.0, 1.4);
  const rBase = rng.range(0.16, 0.23);
  const [tr, tg, tb] = TINT['tree-apple'];

  // gnarled trunk: hand-walked centerline with two forced kinks
  const bendA = rng.range(0, Math.PI * 2);
  const bendB = bendA + rng.range(1.8, 3.6);
  const segs = q.trunk.segs;
  const pts: Vector3[] = [];
  const dirs: Vector3[] = [];
  const dir = new Vector3(rng.range(-0.1, 0.1), 1, rng.range(-0.1, 0.1)).normalize();
  const pos = new Vector3(0, -0.3, 0);
  pts.push(pos.clone());
  dirs.push(dir.clone());
  const kink1 = Math.max(1, Math.round(segs * 0.35));
  const kink2 = Math.max(kink1 + 1, Math.round(segs * 0.75));
  const step = (trunkH + 0.3 + 0.3) / segs;
  for (let i = 1; i <= segs; i++) {
    if (i === kink1) dir.add(new Vector3(Math.cos(bendA), 0, Math.sin(bendA)).multiplyScalar(rng.range(0.35, 0.6)));
    if (i === kink2) dir.add(new Vector3(Math.cos(bendB), 0, Math.sin(bendB)).multiplyScalar(rng.range(0.3, 0.55)));
    dir.x += rng.range(-0.09, 0.09);
    dir.z += rng.range(-0.09, 0.09);
    dir.y += 0.14; // keep it climbing
    dir.normalize();
    pos.addScaledVector(dir, step * rng.range(0.9, 1.1));
    pts.push(pos.clone());
    dirs.push(dir.clone());
  }
  const trunkLine: Polyline = { pts, dirs };
  const trunkFlexTip = 0.3;
  const barkParts: BufferGeometry[] = [
    makeTube({
      seed: rng.int(1, SEED_MAX),
      line: trunkLine,
      rBase,
      rTip: rBase * 0.5,
      radial: q.trunk.radial,
      noiseAmp: rBase * 0.28,
      flare: rng.range(0.25, 0.5),
      flexBase: 0.02,
      flexTip: trunkFlexTip,
    }),
  ];

  const blobs: BufferGeometry[] = [];
  const blob = (x: number, y: number, z: number, r: number, detail: number): void => {
    blobs.push(
      makeBlob({
        seed: rng.int(1, SEED_MAX),
        detail,
        amp: rng.range(0.28, 0.36),
        freq: rng.range(1.3, 1.9),
        sx: r * rng.range(0.92, 1.1),
        sy: r * rng.range(0.78, 0.94),
        sz: r * rng.range(0.9, 1.1),
        x,
        y,
        z,
        rotY: rng.range(0, Math.PI * 2),
        tintR: tr,
        tintG: tg,
        tintB: tb,
        value: rng.range(0.82, 1.08),
        flexBase: clusterFlex(y + totalH * 0.25, totalH, rng), // low trees still breeze
      }),
    );
  };

  const nB = rng.int(q.nBranch[0], q.nBranch[1]);
  for (let i = 0; i < nB; i++) {
    const az = (i / nB) * Math.PI * 2 + rng.range(-0.6, 0.6);
    const attachT = rng.range(0.55, 0.95);
    const s = sampleLine(trunkLine, attachT);
    const elev = rng.range(0.85, 1.25);
    const dir0 = new Vector3(Math.cos(az) * Math.sin(elev), Math.cos(elev), Math.sin(az) * Math.sin(elev));
    const len = rng.range(0.75, 1.35);
    const bLine = walk(rng, s.pos, dir0, len, q.branch.segs, {
      wander: 0.16,
      droop: rng.range(0.15, 0.35),
      curl: rng.range(0.1, 0.25),
      upBias: 0,
    });
    const brB = rBase * rng.range(0.4, 0.52);
    barkParts.push(
      makeTube({
        seed: rng.int(1, SEED_MAX),
        line: bLine,
        rBase: brB,
        rTip: 0.016,
        radial: q.branch.radial,
        noiseAmp: brB * 0.2,
        flare: 0,
        flexBase: lerp(0.02, trunkFlexTip, Math.pow(attachT, 1.35)),
        flexTip: 0.6,
      }),
    );
    const tip = bLine.pts[bLine.pts.length - 1] as Vector3;
    blob(tip.x, tip.y + rng.range(0.05, 0.25), tip.z, rng.range(0.6, 0.95), q.tipDetail);
  }
  // round crown mass above the trunk top
  const top = pts[pts.length - 1] as Vector3;
  for (let k = 0; k < q.crown; k++) {
    const az = rng.range(0, Math.PI * 2);
    const rad = rng.range(0.1, 0.55);
    blob(top.x + Math.cos(az) * rad, top.y + rng.range(0.15, 0.6), top.z + Math.sin(az) * rad, rng.range(0.85, 1.25), q.crownDetail);
  }

  const bark = merged(barkParts);
  const canopy = merged(blobs);
  applyCanopyShading(canopy, 0.66, 1.12);
  tilt([bark, canopy], rng.range(0, Math.PI * 2), rng.range(0.01, 0.05));
  return { bark, canopy, sink: 0.25 };
}

/** Scruffy roadside/field bush: 2-3 clusters plus twiggy sticks poking out. */
function buildBush(rng: Rng, rich: boolean): Archetype {
  const nBlob = rng.int(2, 3);
  const [tr, tg, tb] = TINT.bush;
  const r0 = rng.range(0.55, 0.95);

  const blobs: BufferGeometry[] = [];
  for (let k = 0; k < nBlob; k++) {
    const r = k === 0 ? r0 : r0 * rng.range(0.5, 0.75);
    const az = rng.range(0, Math.PI * 2);
    const d = k === 0 ? 0 : r0 * rng.range(0.7, 1.1);
    const sy = r * rng.range(0.7, 0.85);
    blobs.push(
      makeBlob({
        seed: rng.int(1, SEED_MAX),
        detail: rich && k === 0 ? 2 : 1,
        amp: rng.range(0.32, 0.42),
        freq: rng.range(1.3, 2),
        sx: r * rng.range(1.05, 1.35),
        sy,
        sz: r * rng.range(0.95, 1.2),
        x: Math.cos(az) * d,
        y: sy * 0.62,
        z: Math.sin(az) * d,
        rotY: rng.range(0, Math.PI * 2),
        tintR: tr,
        tintG: tg,
        tintB: tb,
        value: rng.range(0.8, 1.05),
        flexBase: 0.62 + 0.1 * k + rng.range(0, 0.06),
      }),
    );
  }

  const twigs: BufferGeometry[] = [];
  const nTwig = rng.int(3, rich ? 5 : 4);
  for (let k = 0; k < nTwig; k++) {
    const az = rng.range(0, Math.PI * 2);
    const elevT = rng.range(0.15, 0.7);
    const dir0 = new Vector3(Math.cos(az) * Math.sin(elevT), Math.cos(elevT), Math.sin(az) * Math.sin(elevT));
    const start = new Vector3(rng.range(-0.25, 0.25), 0, rng.range(-0.25, 0.25));
    const line = walk(rng, start, dir0, rng.range(0.7, 1.3), 2, { wander: 0.18, droop: 0.06, curl: 0.12, upBias: 0 });
    twigs.push(
      makeTube({
        seed: rng.int(1, SEED_MAX),
        line,
        rBase: rng.range(0.028, 0.042),
        rTip: 0.008,
        radial: 4,
        noiseAmp: 0.004,
        flare: 0,
        flexBase: 0.15,
        flexTip: 0.8,
      }),
    );
  }

  const canopy = merged(blobs);
  applyCanopyShading(canopy, 0.72, 1.08);
  return { bark: merged(twigs), canopy, sink: 0.12 };
}

function buildArchetype(kind: FoliageKind, rng: Rng, archIndex: number, preset: GraphicsPreset): Archetype {
  const low = preset === 'low';
  const tier = Math.min(2, low ? archIndex + 1 : archIndex);
  switch (kind) {
    case 'tree-oak':
      return buildOak(rng, OAK_Q[tier] as OakQ);
    case 'tree-poplar':
      return buildPoplar(rng, !low);
    case 'tree-apple':
      return buildApple(rng, APPLE_Q[tier] as AppleQ);
    case 'bush':
      return buildBush(rng, !low);
  }
}

// ------------------------------------------------------------------- build

/**
 * Build all trees/bushes from model.props as instanced meshes sitting on the
 * terrain. Non-foliage prop kinds are ignored (handled elsewhere).
 */
export function buildFoliage(model: WorldModel, ground: Ground, preset: GraphicsPreset): Group {
  const group = new Group();
  group.name = 'foliage';
  const low = preset === 'low';
  const archCount = low ? 2 : 3;
  const materials = makeFoliageMaterials(model.seed);

  // Bucket foliage specs by (kind, weighted deterministic archetype pick).
  const buckets = new Map<FoliageKind, PropSpec[][]>();
  for (const spec of model.props) {
    const kind = foliageKind(spec.kind);
    if (!kind) continue;
    let arr = buckets.get(kind);
    if (!arr) {
      arr = Array.from({ length: archCount }, (): PropSpec[] => []);
      buckets.set(kind, arr);
    }
    const salt = (model.seed ^ ARCH_SALT[kind]) >>> 0;
    arr[pickArchetype(spec, archWeights(kind, preset), salt)]?.push(spec);
  }

  const up = new Vector3(0, 1, 0);
  const mat = new Matrix4();
  const posV = new Vector3();
  const quat = new Quaternion();
  const sclV = new Vector3();
  const color = new Color();

  for (const kind of FOLIAGE_KINDS) {
    const arr = buckets.get(kind);
    if (!arr) continue;
    for (let ai = 0; ai < archCount; ai++) {
      const specs = arr[ai];
      if (!specs || specs.length === 0) continue;

      const arng = new Rng(model.seed).fork(`foliage:${kind}#${ai}`);
      const arch = buildArchetype(kind, arng, ai, preset);
      const barkMesh = new InstancedMesh(arch.bark, materials.bark, specs.length);
      const canopyMesh = new InstancedMesh(arch.canopy, materials.leaf, specs.length);
      barkMesh.name = `foliage:${kind}:${ai}:bark`;
      canopyMesh.name = `foliage:${kind}:${ai}:leaf`;

      for (let i = 0; i < specs.length; i++) {
        const spec = specs[i];
        if (!spec) continue;
        const irng = new Rng((spec.seed ^ 0x517f0a) >>> 0);
        const s = spec.scale * irng.range(0.92, 1.08);
        posV.set(spec.x, ground.height(spec.x, spec.z) - arch.sink * s, spec.z);
        quat.setFromAxisAngle(up, -spec.rotation);
        sclV.setScalar(s);
        mat.compose(posV, quat, sclV);
        barkMesh.setMatrixAt(i, mat);
        canopyMesh.setMatrixAt(i, mat);

        // Canopy multiplier: olive → fresh green, ~7% dry-tan individuals.
        const dry = irng.chance(0.07);
        const hueT = irng.float();
        const vj = irng.range(0.9, 1.1);
        if (dry) {
          color.setRGB(1.3 * vj, 1.0 * vj, 0.52 * vj);
        } else {
          color.setRGB(lerp(1.0, 0.68, hueT) * vj, lerp(0.86, 1.06, hueT) * vj, lerp(0.6, 0.52, hueT) * vj);
        }
        canopyMesh.setColorAt(i, color);

        // Subtle warm/cool value drift on bark.
        const tv = irng.range(0.86, 1.14);
        color.setRGB(tv * 1.05, tv, tv * 0.93);
        barkMesh.setColorAt(i, color);
      }

      barkMesh.castShadow = true;
      barkMesh.receiveShadow = true;
      canopyMesh.castShadow = true;
      canopyMesh.receiveShadow = true;
      barkMesh.computeBoundingSphere();
      canopyMesh.computeBoundingSphere();
      group.add(barkMesh, canopyMesh);
    }
  }
  return group;
}
