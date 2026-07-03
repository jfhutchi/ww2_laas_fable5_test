/**
 * FoliageGenerator — instanced trees and bushes for the Normandy valley.
 *
 * A small set of seeded archetypes is built per foliage kind (hedgerow oak,
 * roadside poplar, orchard apple, scruffy bush). Each archetype is split into
 * a bark part (trunk + branch limbs, merged) and a canopy part (displaced
 * icosphere blobs, merged) with per-vertex colour baked in. Every matching
 * PropSpec is then drawn through one InstancedMesh per (kind, archetype,
 * part) — at most 24 draw calls — with per-instance colour multipliers
 * (olive → fresh summer green, ~7% dry-tan individuals) so no two
 * neighbouring trees read as clones. Fully deterministic from model.seed.
 */

import {
  BufferAttribute,
  BufferGeometry,
  Color,
  CylinderGeometry,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
} from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import type { GraphicsPreset } from '../app/Config.ts';
import { clamp01, lerp } from '../core/MathUtil.ts';
import { fbm2D } from '../core/Noise.ts';
import { hash2D, Rng } from '../core/Random.ts';
import type { Ground } from '../world/Ground.ts';
import type { PropKind, PropSpec, WorldModel } from '../world/WorldTypes.ts';

// --------------------------------------------------------------- materials

/** Shared bark material — vertex colours carry all bark variation. */
const barkMaterial = new MeshStandardMaterial({ vertexColors: true, roughness: 0.94, metalness: 0 });
/** Shared leaf material — vertex colours × instanceColor carry the greens. */
const leafMaterial = new MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 });

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

interface Archetype {
  bark: BufferGeometry;
  canopy: BufferGeometry;
  /** How far the trunk base sinks below the terrain sample (× instance scale). */
  sink: number;
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
}

/** One displaced icosphere foliage blob with baked per-vertex colour. */
function makeBlob(o: BlobOpts): BufferGeometry {
  const raw = new IcosahedronGeometry(1, o.detail);
  raw.deleteAttribute('uv');
  raw.deleteAttribute('normal');
  const geo = mergeVertices(raw, 1e-4);

  const pos = positions(geo);
  for (let i = 0; i < pos.count; i++) {
    const px = pos.getX(i);
    const py = pos.getY(i);
    const pz = pos.getZ(i);
    const n = fbm3(px * o.freq + 11.7, py * o.freq + 3.9, pz * o.freq - 5.3, o.seed);
    const r = 1 + o.amp * (n * 2 - 1);
    pos.setXYZ(i, px * r, py * r, pz * r);
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
    const v = o.value * jit;
    colors[i * 3] = o.tintR * v;
    colors[i * 3 + 1] = o.tintG * v;
    colors[i * 3 + 2] = o.tintB * v;
  }
  geo.setAttribute('color', new BufferAttribute(colors, 3));
  return geo;
}

/** Darken canopy undersides / interiors, lift the sun-facing crown. */
function applyCanopyShading(geo: BufferGeometry, dark: number, light: number): void {
  const pos = positions(geo);
  const color = geo.getAttribute('color') as BufferAttribute;
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

// ------------------------------------------------------------ trunks/limbs

interface LimbOpts {
  seed: number;
  height: number;
  rBase: number;
  rTop: number;
  radial: number;
  hSegs: number;
  /** Sideways drift of the tip in meters (gnarled trunks). */
  bend: number;
  bendDir: number;
  /** Radial vertex noise amplitude in meters — no perfect tubes. */
  noiseAmp: number;
  /** Root flare strength at the base (0 = none). */
  flare: number;
}

/** Tapered, noised, optionally bent limb; base at local origin, +Y up. */
function makeLimb(o: LimbOpts): BufferGeometry {
  const raw = new CylinderGeometry(o.rTop, o.rBase, o.height, o.radial, o.hSegs, true);
  raw.translate(0, o.height / 2, 0);
  raw.deleteAttribute('uv');
  raw.deleteAttribute('normal');
  const geo = mergeVertices(raw, 1e-4);

  const pos = positions(geo);
  const bx = Math.cos(o.bendDir);
  const bz = Math.sin(o.bendDir);
  for (let i = 0; i < pos.count; i++) {
    const px = pos.getX(i);
    const py = pos.getY(i);
    const pz = pos.getZ(i);
    const t = clamp01(py / o.height);
    const rl = Math.hypot(px, pz);
    if (rl < 1e-6) continue;
    const dx = px / rl;
    const dz = pz / rl;
    const flare = 1 + o.flare * (1 - t) ** 3;
    const noise = (fbm3(px * 3.2, py * 1.05, pz * 3.2, o.seed) * 2 - 1) * o.noiseAmp;
    const r = Math.max(0.01, rl * flare + noise);
    const drift = o.bend * t * t;
    pos.setXYZ(i, dx * r + bx * drift, py, dz * r + bz * drift);
  }
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
    const v = (0.82 + 0.36 * streak) * (0.93 + 0.14 * grain) * lerp(0.8, 1.04, hFade);
    const moss = (1 - hFade) * 0.45 * grain;
    colors[i * 3] = lerp(BARK_R, MOSS_R, moss) * v;
    colors[i * 3 + 1] = lerp(BARK_G, MOSS_G, moss) * v;
    colors[i * 3 + 2] = lerp(BARK_B, MOSS_B, moss) * v;
  }
  geo.setAttribute('color', new BufferAttribute(colors, 3));
}

/** Orient a limb built along +Y: tilt from vertical, spin to azimuth, attach. */
function attachLimb(limb: BufferGeometry, ax: number, ay: number, az: number, azimuth: number, tiltAngle: number): void {
  const m = new Matrix4()
    .makeTranslation(ax, ay, az)
    .multiply(new Matrix4().makeRotationY(azimuth))
    .multiply(new Matrix4().makeRotationZ(tiltAngle));
  limb.applyMatrix4(m);
}

// -------------------------------------------------------------- archetypes

/** Broad hedgerow oak, ~7-10 m, asymmetric light-competition crown. */
function buildOak(rng: Rng, low: boolean): Archetype {
  const detail = low ? 1 : 2;
  const totalH = rng.range(7, 10);
  const trunkH = totalH * rng.range(0.3, 0.38);
  const rBase = rng.range(0.3, 0.42);

  const barkParts: BufferGeometry[] = [
    makeLimb({
      seed: rng.int(1, 0x7fffffff),
      height: trunkH + 0.8,
      rBase,
      rTop: rBase * rng.range(0.52, 0.66),
      radial: 9,
      hSegs: 5,
      bend: rng.range(0.05, 0.3),
      bendDir: rng.range(0, Math.PI * 2),
      noiseAmp: rBase * 0.2,
      flare: rng.range(0.3, 0.55),
    }),
  ];

  const nBranch = rng.int(3, 5);
  for (let k = 0; k < nBranch; k++) {
    const az = (k / nBranch) * Math.PI * 2 + rng.range(-0.5, 0.5);
    const rb = rBase * rng.range(0.28, 0.4);
    const branch = makeLimb({
      seed: rng.int(1, 0x7fffffff),
      height: rng.range(1.7, 3),
      rBase: rb,
      rTop: rb * 0.4,
      radial: 6,
      hSegs: 2,
      bend: rng.range(0, 0.35),
      bendDir: rng.range(0, Math.PI * 2),
      noiseAmp: rb * 0.18,
      flare: 0,
    });
    attachLimb(branch, Math.cos(az) * rBase * 0.5, trunkH * rng.range(0.72, 1), -Math.sin(az) * rBase * 0.5, az, rng.range(0.55, 1.05));
    barkParts.push(branch);
  }

  const [tr, tg, tb] = TINT['tree-oak'];
  const R = totalH * rng.range(0.3, 0.4);
  const leanDir = rng.range(0, Math.PI * 2);
  const leanAmt = rng.range(0.4, 1.1);
  const canopyBase = trunkH + 0.3;
  const nBlob = Math.max(3, Math.round(rng.int(6, 10) * (low ? 0.6 : 1)));
  const blobs: BufferGeometry[] = [];

  // crown core keeps the silhouette closed above the trunk
  const coreR = R * rng.range(0.72, 0.92);
  blobs.push(
    makeBlob({
      seed: rng.int(1, 0x7fffffff),
      detail,
      amp: 0.3,
      freq: rng.range(1, 1.5),
      sx: coreR,
      sy: coreR * 0.82,
      sz: coreR * rng.range(0.9, 1.05),
      x: Math.cos(leanDir) * leanAmt * 0.4,
      y: (canopyBase + totalH) / 2,
      z: Math.sin(leanDir) * leanAmt * 0.4,
      rotY: rng.range(0, Math.PI * 2),
      tintR: tr,
      tintG: tg,
      tintB: tb,
      value: rng.range(0.88, 1.05),
    }),
  );
  for (let k = 1; k < nBlob; k++) {
    const br = R * rng.range(0.42, 0.6);
    const az = rng.range(0, Math.PI * 2);
    const rad = R * rng.range(0.3, 0.85);
    const by = lerp(canopyBase + br * 0.4, totalH - br * 0.55, rng.float());
    const leanT = clamp01((by - canopyBase) / Math.max(1e-6, totalH - canopyBase));
    blobs.push(
      makeBlob({
        seed: rng.int(1, 0x7fffffff),
        detail,
        amp: 0.3,
        freq: rng.range(1.1, 1.7),
        sx: br,
        sy: br * rng.range(0.72, 0.9),
        sz: br * rng.range(0.85, 1.1),
        x: Math.cos(az) * rad + Math.cos(leanDir) * leanAmt * leanT,
        y: by,
        z: Math.sin(az) * rad + Math.sin(leanDir) * leanAmt * leanT,
        rotY: rng.range(0, Math.PI * 2),
        tintR: tr,
        tintG: tg,
        tintB: tb,
        value: rng.range(0.8, 1.1),
      }),
    );
  }

  const bark = merged(barkParts);
  const canopy = merged(blobs);
  applyCanopyShading(canopy, 0.6, 1.14);
  tilt([bark, canopy], rng.range(0, Math.PI * 2), rng.range(0, 0.045));
  return { bark, canopy, sink: 0.3 };
}

/** Tall columnar poplar, 11-14 m, slight lean. */
function buildPoplar(rng: Rng, low: boolean): Archetype {
  const detail = low ? 1 : 2;
  const totalH = rng.range(11, 14);
  const trunkH = rng.range(1.7, 2.6);
  const rBase = rng.range(0.2, 0.28);

  const bark = makeLimb({
    seed: rng.int(1, 0x7fffffff),
    height: trunkH + 1.2,
    rBase,
    rTop: rBase * 0.7,
    radial: 8,
    hSegs: 4,
    bend: rng.range(0, 0.12),
    bendDir: rng.range(0, Math.PI * 2),
    noiseAmp: rBase * 0.16,
    flare: rng.range(0.25, 0.45),
  });

  const [tr, tg, tb] = TINT['tree-poplar'];
  const nBlob = Math.max(2, Math.round(rng.int(2, 3) * (low ? 0.6 : 1)));
  const base = trunkH * 0.85;
  const span = totalH - base;
  const blobs: BufferGeometry[] = [];
  for (let k = 0; k < nBlob; k++) {
    const f = nBlob > 1 ? k / (nBlob - 1) : 0.5;
    const sy = (span / nBlob) * rng.range(0.72, 0.85);
    const sxz = rng.range(1.15, 1.55) * lerp(1, 0.62, f);
    blobs.push(
      makeBlob({
        seed: rng.int(1, 0x7fffffff),
        detail,
        amp: 0.2,
        freq: rng.range(1.5, 2.1),
        sx: sxz,
        sy: Math.max(sy, sxz * 1.6),
        sz: sxz * rng.range(0.88, 1.05),
        x: rng.range(-0.15, 0.15),
        y: lerp(base + sy, totalH - sy * 0.9, f),
        z: rng.range(-0.15, 0.15),
        rotY: rng.range(0, Math.PI * 2),
        tintR: tr,
        tintG: tg,
        tintB: tb,
        value: rng.range(0.85, 1.06),
      }),
    );
  }

  const canopy = merged(blobs);
  applyCanopyShading(canopy, 0.68, 1.12);
  tilt([bark, canopy], rng.range(0, Math.PI * 2), rng.range(0.025, 0.075));
  return { bark, canopy, sink: 0.25 };
}

/** Low gnarled orchard apple, 3.5-4.5 m. */
function buildApple(rng: Rng, low: boolean): Archetype {
  const detail = low ? 1 : 2;
  const totalH = rng.range(3.5, 4.5);
  const trunkH = rng.range(1, 1.45);
  const rBase = rng.range(0.15, 0.22);
  const bendDir = rng.range(0, Math.PI * 2);

  const barkParts: BufferGeometry[] = [
    makeLimb({
      seed: rng.int(1, 0x7fffffff),
      height: trunkH + 0.5,
      rBase,
      rTop: rBase * 0.55,
      radial: 8,
      hSegs: 5,
      bend: rng.range(0.22, 0.42),
      bendDir,
      noiseAmp: rBase * 0.3,
      flare: rng.range(0.25, 0.5),
    }),
  ];
  const nBranch = rng.int(2, 3);
  for (let k = 0; k < nBranch; k++) {
    const az = (k / nBranch) * Math.PI * 2 + rng.range(-0.7, 0.7);
    const rb = rBase * rng.range(0.4, 0.55);
    const branch = makeLimb({
      seed: rng.int(1, 0x7fffffff),
      height: rng.range(0.7, 1.2),
      rBase: rb,
      rTop: rb * 0.42,
      radial: 6,
      hSegs: 2,
      bend: rng.range(0, 0.2),
      bendDir: rng.range(0, Math.PI * 2),
      noiseAmp: rb * 0.2,
      flare: 0,
    });
    attachLimb(branch, Math.cos(az) * rBase * 0.4, trunkH * rng.range(0.8, 1), -Math.sin(az) * rBase * 0.4, az, rng.range(0.7, 1.15));
    barkParts.push(branch);
  }

  const [tr, tg, tb] = TINT['tree-apple'];
  const nBlob = Math.max(2, Math.round(rng.int(2, 4) * (low ? 0.6 : 1)));
  const R = rng.range(1.25, 1.7);
  const centerY = trunkH + (totalH - trunkH) * 0.45;
  const blobs: BufferGeometry[] = [];
  for (let k = 0; k < nBlob; k++) {
    const br = R * rng.range(0.6, 0.85);
    const az = rng.range(0, Math.PI * 2);
    const rad = R * rng.range(0.15, 0.5);
    blobs.push(
      makeBlob({
        seed: rng.int(1, 0x7fffffff),
        detail,
        amp: 0.32,
        freq: rng.range(1.3, 1.9),
        sx: br,
        sy: br * rng.range(0.7, 0.82),
        sz: br * rng.range(0.88, 1.08),
        x: Math.cos(az) * rad + Math.cos(bendDir) * 0.3,
        y: centerY + rng.range(-0.25, 0.35),
        z: Math.sin(az) * rad + Math.sin(bendDir) * 0.3,
        rotY: rng.range(0, Math.PI * 2),
        tintR: tr,
        tintG: tg,
        tintB: tb,
        value: rng.range(0.82, 1.08),
      }),
    );
  }

  const bark = merged(barkParts);
  const canopy = merged(blobs);
  applyCanopyShading(canopy, 0.66, 1.12);
  tilt([bark, canopy], rng.range(0, Math.PI * 2), rng.range(0.01, 0.05));
  return { bark, canopy, sink: 0.2 };
}

/** Scruffy roadside/field bush, 1-2 ground blobs plus poking twigs. */
function buildBush(rng: Rng, low: boolean): Archetype {
  const detail = low ? 1 : 2;
  const nRaw = rng.int(1, 2);
  const nBlob = low ? 1 : nRaw;
  const [tr, tg, tb] = TINT.bush;
  const r0 = rng.range(0.55, 0.95);

  const blobs: BufferGeometry[] = [];
  for (let k = 0; k < nBlob; k++) {
    const r = k === 0 ? r0 : r0 * rng.range(0.55, 0.8);
    const az = rng.range(0, Math.PI * 2);
    const d = k === 0 ? 0 : r0 * rng.range(0.7, 1.1);
    const sy = r * rng.range(0.7, 0.85);
    blobs.push(
      makeBlob({
        seed: rng.int(1, 0x7fffffff),
        detail,
        amp: 0.38,
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
      }),
    );
  }

  const twigs: BufferGeometry[] = [];
  const nTwig = rng.int(2, 3);
  for (let k = 0; k < nTwig; k++) {
    const twig = makeLimb({
      seed: rng.int(1, 0x7fffffff),
      height: rng.range(0.7, 1.25),
      rBase: rng.range(0.028, 0.045),
      rTop: 0.012,
      radial: 5,
      hSegs: 1,
      bend: 0,
      bendDir: 0,
      noiseAmp: 0.004,
      flare: 0,
    });
    attachLimb(twig, rng.range(-0.25, 0.25), 0, rng.range(-0.25, 0.25), rng.range(0, Math.PI * 2), rng.range(0.15, 0.7));
    twigs.push(twig);
  }

  const canopy = merged(blobs);
  applyCanopyShading(canopy, 0.72, 1.08);
  return { bark: merged(twigs), canopy, sink: 0.12 };
}

function buildArchetype(kind: FoliageKind, rng: Rng, low: boolean): Archetype {
  switch (kind) {
    case 'tree-oak':
      return buildOak(rng, low);
    case 'tree-poplar':
      return buildPoplar(rng, low);
    case 'tree-apple':
      return buildApple(rng, low);
    case 'bush':
      return buildBush(rng, low);
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

  // Bucket foliage specs by (kind, spec.seed % archetypeCount).
  const buckets = new Map<FoliageKind, PropSpec[][]>();
  for (const spec of model.props) {
    const kind = foliageKind(spec.kind);
    if (!kind) continue;
    let arr = buckets.get(kind);
    if (!arr) {
      arr = Array.from({ length: archCount }, (): PropSpec[] => []);
      buckets.set(kind, arr);
    }
    arr[((spec.seed % archCount) + archCount) % archCount]?.push(spec);
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
      const arch = buildArchetype(kind, arng, low);
      const barkMesh = new InstancedMesh(arch.bark, barkMaterial, specs.length);
      const canopyMesh = new InstancedMesh(arch.canopy, leafMaterial, specs.length);
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
