/**
 * BarrierMeshes — render meshes for every BarrierSegment in the WorldModel:
 *
 *  - 'stone-wall': dry-stone field walls assembled stone by stone (2-3
 *    courses of jittered stone blocks + flat capstones), with rubble gaps
 *    and fallen stones where seg.broken > 0.
 *  - 'hedgerow': the bocage bank — a merged earthen-berm ridge mesh that
 *    hugs the terrain, a dense mass of instanced flat-shaded leaf blobs in
 *    two overlapping layers, and trunk sticks poking through.
 *  - 'fence': weathered post-and-rail pasture fencing with leaning posts
 *    and sagging split rails.
 *
 * Instancing strategy: transforms for ALL segments are collected first,
 * then exactly ONE InstancedMesh per archetype geometry is emitted for the
 * whole map (≤ 14 draw calls on 'high'). Every random value derives from
 * Rng streams seeded by model/segment seeds — same seed, identical bocage.
 *
 * Rotation convention: a segment direction θ = atan2(dz, dx) is realized on
 * instances via yaw = -θ (three.js Y-up), matching WorldTypes layout math.
 */

import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  CylinderGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  OctahedronGeometry,
  Quaternion,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { BarrierSegment, WorldModel } from '../world/WorldTypes.ts';
import type { Ground } from '../world/Ground.ts';
import type { GraphicsPreset } from '../app/Config.ts';
import { Rng, hash2D } from '../core/Random.ts';
import { valueNoise2D } from '../core/Noise.ts';
import { clamp01, lerp, smoothstep } from '../core/MathUtil.ts';

// ---------------------------------------------------------------- materials
// Shared at module scope so repeated builds reuse pipelines. Albedo lives in
// vertex colors (per-face weathering) × instance colors (per-piece jitter).

const stoneMaterial = new MeshStandardMaterial({ vertexColors: true, roughness: 0.94, metalness: 0.02 });
const foliageMaterial = new MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 });
const woodMaterial = new MeshStandardMaterial({ vertexColors: true, roughness: 0.86, metalness: 0 });
const bermMaterial = new MeshStandardMaterial({ vertexColors: true, roughness: 0.98, metalness: 0 });

// ------------------------------------------------------------------- tuning

interface Tune {
  /** Stone archetype count + box subdivision per archetype. */
  stoneSegs: [number, number, number][];
  /** Multiplies stone length (bigger stones = fewer instances on low). */
  stoneLenMul: number;
  /** Berm ring spacing along the segment (m). */
  bermStep: number;
  /** Foliage blob archetype count. */
  blobArch: number;
  /** Multiplies blob spacing (2 = half the blobs). */
  blobSpacingMul: number;
  /** Trunk stick spacing (m); trunks appear near the village only. */
  trunkSpacing: number;
}

const TUNES: Record<GraphicsPreset, Tune> = {
  low: {
    stoneSegs: [
      [2, 2, 2],
      [2, 2, 2],
    ],
    stoneLenMul: 1.35,
    bermStep: 5.4,
    blobArch: 2,
    blobSpacingMul: 2,
    trunkSpacing: 15,
  },
  high: {
    stoneSegs: [
      [3, 2, 2],
      [3, 2, 2],
      [2, 2, 2],
      [2, 2, 2],
      [2, 2, 2],
      [2, 2, 2],
    ],
    stoneLenMul: 1,
    bermStep: 4.2,
    blobArch: 4,
    blobSpacingMul: 1,
    trunkSpacing: 7,
  },
  ultra: {
    stoneSegs: [
      [3, 2, 2],
      [3, 2, 2],
      [2, 2, 2],
      [2, 2, 2],
      [2, 2, 2],
      [2, 2, 2],
    ],
    stoneLenMul: 0.94,
    bermStep: 3.5,
    blobArch: 4,
    blobSpacingMul: 0.85,
    trunkSpacing: 5.5,
  },
};

/** Hedges inside this radius get the dense treatment; beyond it, fewer but
 *  larger blobs keep the silhouette identical from tactical distance. */
const NEAR_RADIUS = 430;
const TOP_SPACING_NEAR = 3.4;
const TOP_SPACING_FAR = 6.6;
const SIDE_SPACING_NEAR = 5.2;
const SIDE_SPACING_FAR = 12.0;
const FENCE_POST_SPACING = 2.2;

// ------------------------------------------------------------------ helpers

const Y_AXIS = new Vector3(0, 1, 0);
const Z_AXIS = new Vector3(0, 0, 1);
const X_AXIS = new Vector3(1, 0, 0);
const _pos = new Vector3();
const _scl = new Vector3();
const _quat = new Quaternion();
const _qTmp = new Quaternion();

/** Compose a TRS matrix: yaw about Y, then local Z pitch, then local X roll. */
function composeMatrix(
  px: number,
  py: number,
  pz: number,
  yaw: number,
  pitch: number,
  roll: number,
  sx: number,
  sy: number,
  sz: number,
): Matrix4 {
  _quat.setFromAxisAngle(Y_AXIS, yaw);
  if (pitch !== 0) {
    _qTmp.setFromAxisAngle(Z_AXIS, pitch);
    _quat.multiply(_qTmp);
  }
  if (roll !== 0) {
    _qTmp.setFromAxisAngle(X_AXIS, roll);
    _quat.multiply(_qTmp);
  }
  _pos.set(px, py, pz);
  _scl.set(sx, sy, sz);
  return new Matrix4().compose(_pos, _quat, _scl);
}

/**
 * Displace vertices with a hash keyed on quantized position so coincident
 * (duplicated) vertices move identically — irregular silhouettes, no cracks.
 */
function jitterVertices(geo: BufferGeometry, seed: number, amp: number, ampY: number): void {
  const pos = geo.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const qx = Math.round(x * 997);
    const key = Math.round(y * 997) * 131071 + Math.round(z * 997) * 379;
    const ox = (hash2D(qx, key, seed) - 0.5) * 2 * amp;
    const oy = (hash2D(qx, key, (seed ^ 0x5b1) >>> 0) - 0.5) * 2 * ampY;
    const oz = (hash2D(qx, key, (seed ^ 0x9e7) >>> 0) - 0.5) * 2 * amp;
    pos.setXYZ(i, x + ox, y + oy, z + oz);
  }
}

/** Non-indexed copy with flat facet normals (chunky hand-hewn look). */
function toFlat(geo: BufferGeometry): BufferGeometry {
  const flat = geo.index ? geo.toNonIndexed() : geo;
  if (flat !== geo) geo.dispose();
  flat.computeVertexNormals();
  return flat;
}

/**
 * Per-face grayscale weathering written into the color attribute (multiplied
 * by instance color at shade time). vGrad tilts value along local Y.
 */
function shadeFaces(geo: BufferGeometry, rng: Rng, min: number, max: number, vGrad: number): void {
  const pos = geo.getAttribute('position');
  geo.computeBoundingBox();
  const bb = geo.boundingBox;
  const y0 = bb ? bb.min.y : 0;
  const span = Math.max(1e-6, (bb ? bb.max.y : 1) - y0);
  const colors = new Float32Array(pos.count * 3);
  for (let f = 0; f < pos.count; f += 3) {
    const s = rng.range(min, max);
    for (let k = 0; k < 3 && f + k < pos.count; k++) {
      const i = f + k;
      const yn = (pos.getY(i) - y0) / span - 0.5;
      const v = Math.max(0.05, s * (1 + vGrad * yn * 2));
      colors[i * 3] = v;
      colors[i * 3 + 1] = v;
      colors[i * 3 + 2] = v;
    }
  }
  geo.setAttribute('color', new BufferAttribute(colors, 3));
}

// ------------------------------------------------------------------ buckets

interface Bucket {
  geometry: BufferGeometry;
  matrices: Matrix4[];
  colors: Color[];
}

function newBucket(geometry: BufferGeometry): Bucket {
  return { geometry, matrices: [], colors: [] };
}

function push(b: Bucket, m: Matrix4, c: Color): void {
  b.matrices.push(m);
  b.colors.push(c);
}

function pickBucket(arr: Bucket[], rng: Rng): Bucket {
  const b = arr[rng.int(0, arr.length - 1)];
  if (!b) throw new Error('BarrierMeshes: empty archetype list');
  return b;
}

function realize(group: Group, b: Bucket, material: MeshStandardMaterial, name: string): void {
  const n = b.matrices.length;
  if (n === 0) return;
  const mesh = new InstancedMesh(b.geometry, material, n);
  mesh.name = name;
  for (let i = 0; i < n; i++) {
    const m = b.matrices[i];
    const c = b.colors[i];
    if (m) mesh.setMatrixAt(i, m);
    if (c) mesh.setColorAt(i, c);
  }
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  // Instances span the whole map; the base geometry's bounds would cull wrong.
  mesh.frustumCulled = false;
  group.add(mesh);
}

// --------------------------------------------------------------- archetypes

function makeStoneArchetypes(rng: Rng, tune: Tune): Bucket[] {
  const out: Bucket[] = [];
  for (const segs of tune.stoneSegs) {
    const geo = new BoxGeometry(1, 1, 1, segs[0], segs[1], segs[2]);
    jitterVertices(geo, rng.int(1, 2 ** 30), 0.2, 0.16);
    const flat = toFlat(geo);
    shadeFaces(flat, rng, 0.84, 1.1, 0.06);
    out.push(newBucket(flat));
  }
  return out;
}

function makeBlobArchetypes(rng: Rng, tune: Tune): Bucket[] {
  const out: Bucket[] = [];
  for (let i = 0; i < tune.blobArch; i++) {
    const geo = new OctahedronGeometry(1, 1);
    jitterVertices(geo, rng.int(1, 2 ** 30), 0.25, 0.27);
    const flat = toFlat(geo);
    shadeFaces(flat, rng, 0.76, 1.14, 0.34);
    out.push(newBucket(flat));
  }
  return out;
}

function makeTrunkArchetype(rng: Rng): BufferGeometry {
  const geo = new CylinderGeometry(0.055, 0.095, 1, 5, 1, true);
  geo.translate(0, 0.5, 0);
  jitterVertices(geo, rng.int(1, 2 ** 30), 0.02, 0.015);
  const flat = toFlat(geo);
  shadeFaces(flat, rng, 0.82, 1.06, 0.1);
  return flat;
}

function makePostArchetype(rng: Rng): BufferGeometry {
  const geo = new BoxGeometry(0.12, 1, 0.12);
  geo.translate(0, 0.5, 0);
  const pos = geo.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    if (pos.getY(i) > 0.9) pos.setXYZ(i, pos.getX(i) * 0.8, pos.getY(i), pos.getZ(i) * 0.8);
  }
  jitterVertices(geo, rng.int(1, 2 ** 30), 0.012, 0.02);
  const flat = toFlat(geo);
  shadeFaces(flat, rng, 0.8, 1.08, 0.26);
  return flat;
}

function makeRailArchetype(rng: Rng): BufferGeometry {
  const geo = new BoxGeometry(1, 0.05, 0.1);
  jitterVertices(geo, rng.int(1, 2 ** 30), 0.005, 0.006);
  const flat = toFlat(geo);
  shadeFaces(flat, rng, 0.82, 1.1, 0.14);
  return flat;
}

// ------------------------------------------------------------------- colors

function stoneColor(rng: Rng, mul: number): Color {
  const v = (1 + rng.range(-0.12, 0.12)) * mul;
  return new Color(
    clamp01((0.52 + rng.range(-0.035, 0.035)) * v),
    clamp01((0.5 + rng.range(-0.03, 0.03)) * v),
    clamp01((0.46 + rng.range(-0.03, 0.03)) * v),
  );
}

function woodColor(rng: Rng): Color {
  const silver = rng.range(0, 0.55); // weathering toward silver-gray
  const v = rng.range(0.8, 1.16);
  return new Color(
    clamp01(lerp(0.42, 0.47, silver) * v),
    clamp01(lerp(0.355, 0.45, silver) * v),
    clamp01(lerp(0.285, 0.425, silver) * v),
  );
}

function blobColor(rng: Rng, tint: number): Color {
  if (rng.chance(0.08)) {
    // the occasional dry-brown individual
    const r = rng.range(0.36, 0.47) * tint;
    const g = r * rng.range(0.7, 0.82);
    return new Color(clamp01(r), clamp01(g), clamp01(g * rng.range(0.45, 0.58)));
  }
  const g = rng.range(0.33, 0.45) * tint;
  const r = g * rng.range(0.6, 0.79);
  return new Color(clamp01(r), clamp01(g), clamp01(g * rng.range(0.38, 0.52)));
}

function barkColor(rng: Rng): Color {
  const v = rng.range(0.82, 1.18);
  return new Color(clamp01(0.27 * v), clamp01(0.215 * v), clamp01(0.165 * v));
}

// ------------------------------------------------------------------ context

interface Ctx {
  ground: Ground;
  tune: Tune;
  worldSeed: number;
  stones: Bucket[];
  blobs: Bucket[];
  trunks: Bucket;
  posts: Bucket;
  rails: Bucket;
  bermGeos: BufferGeometry[];
  /** How many hedgerow segments touch each quantized endpoint (≥2 = flush joint). */
  endUse: Map<string, number>;
}

function endKey(x: number, z: number): string {
  return `${Math.round(x * 4)}|${Math.round(z * 4)}`;
}

// -------------------------------------------------------------- stone walls

function addStoneWall(ctx: Ctx, seg: BarrierSegment): void {
  const dx = seg.x1 - seg.x0;
  const dz = seg.z1 - seg.z0;
  const len = Math.hypot(dx, dz);
  if (len < 0.7) return;
  const dirX = dx / len;
  const dirZ = dz / len;
  const nX = -dirZ;
  const nZ = dirX;
  const yaw0 = -Math.atan2(dirZ, dirX);
  const rng = new Rng(seg.seed);

  const capH = 0.15;
  const courses = seg.height > 1.18 ? 3 : 2;
  const courseH = (seg.height - capH) / courses;
  const gapHalf = seg.broken > 0 ? seg.broken * len * 0.38 : 0;
  const mid = len / 2;

  const dropStone = (tMid: number, c: number): boolean => {
    if (gapHalf <= 0) return false;
    const d = Math.abs(tMid - mid);
    if (d >= gapHalf) return false;
    const edge = smoothstep(0, gapHalf, d); // 0 at gap center → 1 at edge
    return rng.float() > Math.pow(edge, 1 + c * 1.2);
  };

  const fallen = (tMid: number, sLen: number, sy: number): void => {
    if (!rng.chance(0.55)) return;
    const side = rng.chance(0.5) ? 1 : -1;
    const off = side * rng.range(0.45, 1.5);
    const wx = seg.x0 + dirX * tMid + nX * off + rng.range(-0.3, 0.3);
    const wz = seg.z0 + dirZ * tMid + nZ * off + rng.range(-0.3, 0.3);
    const gy = ctx.ground.height(wx, wz);
    const m = composeMatrix(
      wx,
      gy + sy * rng.range(0.22, 0.4),
      wz,
      rng.range(0, Math.PI * 2),
      rng.range(-0.55, 0.55),
      rng.range(-0.55, 0.55),
      sLen * rng.range(0.8, 1.05),
      sy,
      rng.range(0.34, 0.48),
    );
    push(pickBucket(ctx.stones, rng), m, stoneColor(rng, 0.88));
  };

  // 2-3 courses of individual stones, each seated on the terrain profile
  for (let c = 0; c < courses; c++) {
    let t = rng.range(0, 0.35);
    while (t < len - 0.3) {
      const sLen = rng.range(0.62, 1.08) * ctx.tune.stoneLenMul;
      const tMid = t + sLen / 2;
      t += sLen + rng.range(0.02, 0.07);
      if (tMid > len) break;
      const sy = courseH * rng.range(1.0, 1.15);
      if (dropStone(tMid, c)) {
        if (c === 0 || rng.chance(0.4)) fallen(tMid, sLen, sy * 0.9);
        continue;
      }
      const lat = rng.range(-0.055, 0.055);
      const wx = seg.x0 + dirX * tMid + nX * lat;
      const wz = seg.z0 + dirZ * tMid + nZ * lat;
      const gy = ctx.ground.height(wx, wz);
      const m = composeMatrix(
        wx,
        gy - 0.07 + courseH * c + sy * 0.5,
        wz,
        yaw0 + rng.range(-0.09, 0.09),
        rng.range(-0.05, 0.05),
        rng.range(-0.05, 0.05),
        sLen * 1.05,
        sy,
        rng.range(0.36, 0.48),
      );
      push(pickBucket(ctx.stones, rng), m, stoneColor(rng, 1));
    }
  }

  // flat capstones riding the top course, slightly overhanging
  let t = rng.range(0.05, 0.4);
  while (t < len - 0.35) {
    const capLen = rng.range(0.52, 0.8) * ctx.tune.stoneLenMul;
    const tMid = t + capLen / 2;
    t += capLen + rng.range(0.02, 0.08);
    if (tMid > len) break;
    if (gapHalf > 0 && Math.abs(tMid - mid) < gapHalf * 1.12) continue;
    const wx = seg.x0 + dirX * tMid;
    const wz = seg.z0 + dirZ * tMid;
    const gy = ctx.ground.height(wx, wz);
    const capT = rng.range(0.11, 0.16);
    const m = composeMatrix(
      wx,
      gy - 0.07 + courseH * courses + capT * 0.5,
      wz,
      yaw0 + rng.range(-0.11, 0.11),
      rng.range(-0.055, 0.055),
      rng.range(-0.055, 0.055),
      capLen,
      capT,
      rng.range(0.5, 0.64),
    );
    push(pickBucket(ctx.stones, rng), m, stoneColor(rng, 1.06));
  }
}

// --------------------------------------------------------------- hedgerows

function addHedgerow(ctx: Ctx, seg: BarrierSegment): void {
  const dx = seg.x1 - seg.x0;
  const dz = seg.z1 - seg.z0;
  const len = Math.hypot(dx, dz);
  if (len < 1.5) return;
  const dirX = dx / len;
  const dirZ = dz / len;
  const nX = -dirZ;
  const nZ = dirX;
  const yaw0 = -Math.atan2(dirZ, dirX);
  const base = new Rng(seg.seed);
  const rngB = base.fork('berm');
  const rngF = base.fork('foliage');
  const rngT = base.fork('trunks');
  const nSeed = (ctx.worldSeed ^ 0xbe12) >>> 0;

  const bermH = Math.min(rngB.range(1.05, 1.32), seg.height * 0.52);
  const halfW = rngB.range(1.22, 1.45);

  // ---- (1) earthen berm ridge, merged later into one mesh --------------
  // Rounded noses only at free endpoints; flush where pieces continue.
  const steps = Math.max(2, Math.round(len / ctx.tune.bermStep));
  const nose0 = (ctx.endUse.get(endKey(seg.x0, seg.z0)) ?? 0) < 2;
  const nose1 = (ctx.endUse.get(endKey(seg.x1, seg.z1)) ?? 0) < 2;
  const rings: [number, number, number][] = []; // [t, widthScale, heightScale]
  if (nose0) rings.push([-0.85, 0.12, 0.05], [-0.45, 0.6, 0.5]);
  for (let i = 0; i <= steps; i++) rings.push([(i / steps) * len, 1, 1]);
  if (nose1) rings.push([len + 0.45, 0.6, 0.5], [len + 0.85, 0.12, 0.05]);

  const ringCount = rings.length;
  const positions = new Float32Array(ringCount * 7 * 3);
  const colors = new Float32Array(ringCount * 7 * 3);
  let vi = 0;
  for (const ring of rings) {
    const t = ring[0];
    const wS = ring[1];
    const hS = ring[2];
    const cx = seg.x0 + dirX * t;
    const cz = seg.z0 + dirZ * t;
    // world-keyed wobble so contiguous pieces stay seamless at joints
    const wobble = (valueNoise2D(cx * 0.16, cz * 0.16, nSeed) - 0.5) * 0.8;
    for (let k = -3; k <= 3; k++) {
      const f = k / 3;
      const u = f * halfW * wS + wobble;
      const wx = cx + nX * u;
      const wz = cz + nZ * u;
      const gy = ctx.ground.height(wx, wz);
      const prof = Math.pow(0.5 + 0.5 * Math.cos(Math.PI * f), 0.82);
      const hn = 0.78 + 0.5 * valueNoise2D(wx * 0.33, wz * 0.33, (nSeed ^ 0x77) >>> 0);
      const edge = k === -3 || k === 3;
      const y = edge ? gy - 0.26 : gy + bermH * hS * prof * hn;
      positions[vi] = wx;
      positions[vi + 1] = y;
      positions[vi + 2] = wz;
      // soil with root-dark streaks, grassing over toward the crest
      const n1 = valueNoise2D(wx * 0.9, wz * 0.9, (nSeed ^ 0x3a1) >>> 0);
      const n2 = valueNoise2D(wx * 0.21, wz * 0.21, (nSeed ^ 0x77e) >>> 0);
      let v = 0.8 + 0.45 * n1;
      if (n1 < 0.24) v *= 0.72;
      const grassT = clamp01(prof * hS * (0.3 + 0.55 * n2));
      colors[vi] = lerp(0.25, 0.2, grassT) * v;
      colors[vi + 1] = lerp(0.193, 0.235, grassT) * v;
      colors[vi + 2] = lerp(0.138, 0.105, grassT) * v;
      vi += 3;
    }
  }
  const idx: number[] = [];
  for (let r = 0; r < ringCount - 1; r++) {
    for (let k = 0; k < 6; k++) {
      const a = r * 7 + k;
      idx.push(a, a + 1, a + 7, a + 1, a + 8, a + 7);
    }
  }
  const bermGeo = new BufferGeometry();
  bermGeo.setAttribute('position', new BufferAttribute(positions, 3));
  bermGeo.setAttribute('color', new BufferAttribute(colors, 3));
  bermGeo.setIndex(idx);
  ctx.bermGeos.push(bermGeo);

  // ---- (2) dense foliage mass: two overlapping instanced blob layers ---
  const midX = (seg.x0 + seg.x1) / 2;
  const midZ = (seg.z0 + seg.z1) / 2;
  const farK = smoothstep(NEAR_RADIUS * 0.75, NEAR_RADIUS * 1.25, Math.hypot(midX, midZ));
  const spMul = ctx.tune.blobSpacingMul;
  const topSp = lerp(TOP_SPACING_NEAR, TOP_SPACING_FAR, farK) * spMul;
  const sideSp = lerp(SIDE_SPACING_NEAR, SIDE_SPACING_FAR, farK) * spMul;
  const sizeMul = lerp(1, 1.24, farK);
  const segTint = rngF.range(0.88, 1.12); // whole-hedge value shift
  const gapHalf = seg.broken > 0 ? seg.broken * len * 0.35 : 0;

  const blob = (tMid: number, lat: number, r: number, top: boolean): void => {
    const sx = r * rngF.range(1.55, 2.3);
    const sy = r * rngF.range(0.6, 0.85);
    const sz = r * rngF.range(0.95, 1.35);
    const wx = seg.x0 + dirX * tMid + nX * lat;
    const wz = seg.z0 + dirZ * tMid + nZ * lat;
    const gy = ctx.ground.height(wx, wz);
    const cy = top
      ? gy + Math.max(bermH * 0.7, seg.height * rngF.range(0.88, 1.1) - sy * 0.75)
      : gy + bermH * rngF.range(0.55, 0.9) + sy * 0.35;
    const m = composeMatrix(
      wx,
      cy,
      wz,
      yaw0 + rngF.range(-0.35, 0.35),
      rngF.range(-0.13, 0.13),
      rngF.range(-0.13, 0.13),
      sx,
      sy,
      sz,
    );
    push(pickBucket(ctx.blobs, rngF), m, blobColor(rngF, segTint));
  };

  // top layer — carries the ragged skyline
  let t = rngF.range(0, topSp * 0.6);
  while (t < len) {
    const tMid = t + rngF.range(-0.5, 0.5);
    t += topSp * rngF.range(0.82, 1.18);
    if (gapHalf > 0 && Math.abs(tMid - len / 2) < gapHalf) continue;
    blob(tMid, rngF.range(-0.4, 0.4), rngF.range(1.0, 1.42) * sizeMul, true);
  }
  // side layer — alternating flanks, lower and smaller, fattens the mass
  let ts = rngF.range(0, sideSp);
  let side = rngF.chance(0.5) ? 1 : -1;
  while (ts < len) {
    const tMid = ts;
    ts += sideSp * rngF.range(0.8, 1.2);
    const lat = side * rngF.range(0.85, 1.25);
    side = -side;
    if (gapHalf > 0 && Math.abs(tMid - len / 2) < gapHalf) continue;
    blob(tMid, lat, rngF.range(0.7, 1.05) * sizeMul, false);
  }

  // ---- (3) trunk sticks poking through (near the village only) --------
  if (farK < 0.6) {
    let tt = rngT.range(1, ctx.tune.trunkSpacing);
    while (tt < len - 1) {
      const wx = seg.x0 + dirX * tt + nX * rngT.range(-0.3, 0.3);
      const wz = seg.z0 + dirZ * tt + nZ * rngT.range(-0.3, 0.3);
      tt += ctx.tune.trunkSpacing * rngT.range(0.7, 1.4);
      const gy = ctx.ground.height(wx, wz);
      const h = (seg.height - bermH * 0.3) * rngT.range(0.72, 1.02);
      const thick = rngT.range(0.8, 1.5);
      const m = composeMatrix(
        wx,
        gy + bermH * 0.3,
        wz,
        rngT.range(0, Math.PI * 2),
        rngT.range(-0.13, 0.13),
        rngT.range(-0.13, 0.13),
        thick,
        h,
        thick,
      );
      push(ctx.trunks, m, barkColor(rngT));
    }
  }
}

// ------------------------------------------------------------------ fences

function addFence(ctx: Ctx, seg: BarrierSegment): void {
  const dx = seg.x1 - seg.x0;
  const dz = seg.z1 - seg.z0;
  const len = Math.hypot(dx, dz);
  if (len < 2.2) return;
  const dirX = dx / len;
  const dirZ = dz / len;
  const yaw0 = -Math.atan2(dirZ, dirX);
  const rng = new Rng(seg.seed);

  const count = Math.max(2, Math.round(len / FENCE_POST_SPACING) + 1);
  const step = len / (count - 1);
  const gapHalf = seg.broken > 0 ? seg.broken * len * 0.45 : 0;
  const mid = len / 2;

  const px: number[] = [];
  const pz: number[] = [];
  const baseY: number[] = [];
  const topY: number[] = [];
  const present: boolean[] = [];

  for (let i = 0; i < count; i++) {
    const t = i * step;
    const wx = seg.x0 + dirX * t;
    const wz = seg.z0 + dirZ * t;
    const gy = ctx.ground.height(wx, wz);
    const h = seg.height * rng.range(0.92, 1.07);
    const lean1 = rng.gaussian(0, 0.035);
    const lean2 = rng.gaussian(0, 0.035);
    const widthJ = rng.range(0.88, 1.18);
    const ok = !(gapHalf > 0 && Math.abs(t - mid) < gapHalf) && !rng.chance(0.02);
    px.push(wx);
    pz.push(wz);
    baseY.push(gy - 0.05);
    topY.push(gy - 0.05 + h);
    present.push(ok);
    if (!ok) continue;
    const m = composeMatrix(wx, gy - 0.05, wz, yaw0 + rng.range(-0.25, 0.25), lean1, lean2, widthJ, h, widthJ);
    push(ctx.posts, m, woodColor(rng));
  }

  const rail = (ax: number, ay: number, az: number, bx: number, by: number, bz: number): void => {
    const rdx = bx - ax;
    const rdy = by - ay;
    const rdz = bz - az;
    const horiz = Math.hypot(rdx, rdz);
    const rLen = Math.hypot(rdx, rdy, rdz);
    if (rLen < 0.05) return;
    const m = composeMatrix(
      (ax + bx) / 2,
      (ay + by) / 2,
      (az + bz) / 2,
      -Math.atan2(rdz, rdx),
      Math.atan2(rdy, horiz),
      rng.range(-0.09, 0.09),
      rLen * 1.04,
      rng.range(0.85, 1.2),
      rng.range(0.85, 1.2),
    );
    push(ctx.rails, m, woodColor(rng));
  };

  for (let i = 0; i < count - 1; i++) {
    if (!(present[i] ?? false) || !(present[i + 1] ?? false)) continue;
    const ax = px[i] ?? 0;
    const az = pz[i] ?? 0;
    const bx = px[i + 1] ?? 0;
    const bz = pz[i + 1] ?? 0;
    const tA = topY[i] ?? 0;
    const tB = topY[i + 1] ?? 0;
    const bA = baseY[i] ?? 0;
    const bB = baseY[i + 1] ?? 0;
    // top rail: two halves meeting at a sagged midpoint
    if (!rng.chance(0.05)) {
      const yA = tA - rng.range(0.1, 0.17);
      const yB = tB - rng.range(0.1, 0.17);
      const mx = (ax + bx) / 2;
      const mz = (az + bz) / 2;
      const my = (yA + yB) / 2 - rng.range(0.05, 0.11);
      rail(ax, yA, az, mx, my, mz);
      rail(mx, my, mz, bx, yB, bz);
    }
    // lower rail: single piece, follows the terrain grade
    if (!rng.chance(0.07)) {
      rail(ax, bA + (tA - bA) * rng.range(0.38, 0.48), az, bx, bB + (tB - bB) * rng.range(0.38, 0.48), bz);
    }
  }
}

// -------------------------------------------------------------------- main

/** Build all barrier meshes (stone walls, hedgerows, fences) for the model. */
export function buildBarriers(model: WorldModel, ground: Ground, preset: GraphicsPreset): Group {
  const tune = TUNES[preset];
  const archRng = new Rng((model.seed ^ 0x8a1157) >>> 0);
  const ctx: Ctx = {
    ground,
    tune,
    worldSeed: model.seed >>> 0,
    stones: makeStoneArchetypes(archRng.fork('stones'), tune),
    blobs: makeBlobArchetypes(archRng.fork('blobs'), tune),
    trunks: newBucket(makeTrunkArchetype(archRng.fork('trunks'))),
    posts: newBucket(makePostArchetype(archRng.fork('posts'))),
    rails: newBucket(makeRailArchetype(archRng.fork('rails'))),
    bermGeos: [],
    endUse: new Map(),
  };

  for (const seg of model.barriers) {
    if (seg.kind !== 'hedgerow') continue;
    const k0 = endKey(seg.x0, seg.z0);
    const k1 = endKey(seg.x1, seg.z1);
    ctx.endUse.set(k0, (ctx.endUse.get(k0) ?? 0) + 1);
    ctx.endUse.set(k1, (ctx.endUse.get(k1) ?? 0) + 1);
  }

  for (const seg of model.barriers) {
    if (seg.kind === 'stone-wall') addStoneWall(ctx, seg);
    else if (seg.kind === 'hedgerow') addHedgerow(ctx, seg);
    else addFence(ctx, seg);
  }

  const group = new Group();
  group.name = 'barriers';

  ctx.stones.forEach((b, i) => realize(group, b, stoneMaterial, `barrier-stones-${i}`));
  ctx.blobs.forEach((b, i) => realize(group, b, foliageMaterial, `barrier-foliage-${i}`));
  realize(group, ctx.trunks, woodMaterial, 'barrier-trunks');
  realize(group, ctx.posts, woodMaterial, 'barrier-posts');
  realize(group, ctx.rails, woodMaterial, 'barrier-rails');

  if (ctx.bermGeos.length > 0) {
    const merged = mergeGeometries(ctx.bermGeos, false);
    if (merged) {
      merged.computeVertexNormals();
      const berm = new Mesh(merged, bermMaterial);
      berm.name = 'barrier-berm';
      berm.castShadow = true;
      berm.receiveShadow = true;
      group.add(berm);
    }
    for (const g of ctx.bermGeos) g.dispose();
  }

  return group;
}
