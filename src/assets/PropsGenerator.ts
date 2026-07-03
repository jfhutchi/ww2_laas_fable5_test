/**
 * PropsGenerator — builds every non-vegetation prop in the WorldModel:
 * carts, crates, barrels, telephone poles, signposts, rubble piles, wells,
 * haystacks and troughs. Trees and bushes are rendered by the vegetation
 * module and are ignored here.
 *
 * Strategy: low-count bespoke kinds (cart, sign, well, trough) are baked
 * into ONE merged static mesh; repetitive kinds (crate, barrel, pole,
 * haystack, rubble chunks) become InstancedMesh archetypes with per-instance
 * matrix + tint jitter. Everything is deterministic from spec seeds.
 * Draw calls: ≤ 9 total.
 */

import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Euler,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  TorusGeometry,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { PropSpec, WorldModel } from '../world/WorldTypes.ts';
import type { Ground } from '../world/Ground.ts';
import { Rng } from '../core/Random.ts';
import { valueNoise2D } from '../core/Noise.ts';

// ----------------------------------------------------------- shared state

/** Shared weathered wood/stone/iron material — vertex colors carry all hue. */
const MAT_PROP = new MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0.05 });
/** Straw is fully rough. */
const MAT_STRAW = new MeshStandardMaterial({ vertexColors: true, roughness: 1.0, metalness: 0.0 });

// Muted late-afternoon Normandy palette (sRGB hex, converted by Color).
const WOOD_OAK = 0x6f5b43;
const WOOD_PALE = 0x8a7357;
const WOOD_GRAY = 0x7a7060;
const WOOD_DARK = 0x55452f;
const IRON_DARK = 0x3b3733;
const STONE_GRAY = 0x8d8779;
const PLASTER = 0xb1a48c;
const BRICK = 0x8a5843;
const CHARRED = 0x3a3733;
const CREAM = 0xd2c5a3;
const CERAMIC = 0xb6b1a2;
const STRAW = 0xc8a95e;
const WET_DARK = 0x2d302a;
const PIT_DARK = 0x1d1f1c;
const ROPE = 0x9a8f72;

// Scratch objects (build-time only; results are cloned or applied at once).
const _m = new Matrix4();
const _mW = new Matrix4();
const _e = new Euler();
const _q = new Quaternion();
const _qYaw = new Quaternion();
const _qTilt = new Quaternion();
const _qLean = new Quaternion();
const _vPos = new Vector3();
const _vScl = new Vector3();
const _vN = new Vector3();
const _c = new Color();
const UP = new Vector3(0, 1, 0);
const Q_ID = new Quaternion();
const _nOut = { x: 0, y: 1, z: 0 };

// -------------------------------------------------------------- utilities

function attr(geo: BufferGeometry, name: string): BufferAttribute {
  const a = geo.getAttribute(name);
  if (!(a instanceof BufferAttribute)) throw new Error(`PropsGenerator: missing attribute '${name}'`);
  return a;
}

/** Bake a translation + euler rotation into a geometry (rotation about its origin). */
function place(geo: BufferGeometry, tx: number, ty: number, tz: number, rx = 0, ry = 0, rz = 0): BufferGeometry {
  _e.set(rx, ry, rz);
  _m.makeRotationFromEuler(_e);
  _m.setPosition(tx, ty, tz);
  geo.applyMatrix4(_m);
  return geo;
}

/** Per-vertex colors: one part-level tone/warmth shift + per-vertex grain. */
function paint(geo: BufferGeometry, hex: number, rng: Rng, partSpread: number, grain = 0.05): BufferGeometry {
  const pos = attr(geo, 'position');
  const out = new Float32Array(pos.count * 3);
  _c.setHex(hex);
  const tone = 1 + (rng.float() * 2 - 1) * partSpread;
  const warm = (rng.float() * 2 - 1) * 0.05;
  const r = _c.r * tone * (1 + warm);
  const g = _c.g * tone;
  const b = _c.b * tone * (1 - warm);
  for (let i = 0; i < pos.count; i++) {
    const v = 1 + (rng.float() * 2 - 1) * grain;
    out[i * 3] = Math.min(1.2, r * v);
    out[i * 3 + 1] = Math.min(1.2, g * v);
    out[i * 3 + 2] = Math.min(1.2, b * v);
  }
  geo.setAttribute('color', new BufferAttribute(out, 3));
  return geo;
}

/** Multiply painted colors where a local-space predicate holds. */
function darkenWhere(geo: BufferGeometry, factor: number, pred: (x: number, y: number, z: number) => boolean): void {
  const pos = attr(geo, 'position');
  const col = attr(geo, 'color');
  for (let i = 0; i < pos.count; i++) {
    if (pred(pos.getX(i), pos.getY(i), pos.getZ(i))) {
      col.setXYZ(i, col.getX(i) * factor, col.getY(i) * factor, col.getZ(i) * factor);
    }
  }
}

function mergeSafe(parts: BufferGeometry[]): BufferGeometry {
  const merged: BufferGeometry | null = mergeGeometries(parts, false);
  if (!merged) throw new Error('PropsGenerator: geometry merge failed');
  for (const p of parts) p.dispose();
  return merged;
}

interface PlaceOpts {
  /** Meters (× spec.scale) pushed below the terrain surface. */
  sink: number;
  /** 0..1 partial alignment of local up to the ground normal. */
  tilt: number;
  /** Max random lean (radians) around local X/Z. */
  lean: number;
  sx?: number;
  sy?: number;
  sz?: number;
}

/** World matrix for a prop spec (returns a SHARED matrix — apply or clone at once). */
function worldMatrix(spec: PropSpec, ground: Ground, rng: Rng, o: PlaceOpts): Matrix4 {
  const y = ground.height(spec.x, spec.z) - o.sink * spec.scale;
  _qYaw.setFromEuler(_e.set(0, -spec.rotation, 0));
  if (o.tilt > 0) {
    ground.normal(spec.x, spec.z, _nOut);
    _vN.set(_nOut.x, _nOut.y, _nOut.z);
    _qTilt.setFromUnitVectors(UP, _vN);
    _qTilt.slerp(Q_ID, 1 - o.tilt);
    _q.multiplyQuaternions(_qTilt, _qYaw);
  } else {
    _q.copy(_qYaw);
  }
  if (o.lean > 0) {
    _qLean.setFromEuler(_e.set((rng.float() * 2 - 1) * o.lean, 0, (rng.float() * 2 - 1) * o.lean));
    _q.multiply(_qLean);
  }
  _vPos.set(spec.x, y, spec.z);
  _vScl.set(spec.scale * (o.sx ?? 1), spec.scale * (o.sy ?? 1), spec.scale * (o.sz ?? 1));
  return _mW.compose(_vPos, _q, _vScl);
}

/** Near-white per-instance tint with a warm/cool bias. */
function jitterTint(rng: Rng, spread: number): Color {
  const v = 1 + (rng.float() * 2 - 1) * spread;
  const warm = (rng.float() * 2 - 1) * 0.06;
  return new Color(v * (1 + warm), v, v * (1 - warm));
}

interface InstanceItem {
  m: Matrix4;
  c: Color;
}

function makeInstanced(name: string, geo: BufferGeometry, mat: MeshStandardMaterial, items: InstanceItem[]): InstancedMesh {
  const im = new InstancedMesh(geo, mat, items.length);
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (!it) continue;
    im.setMatrixAt(i, it.m);
    im.setColorAt(i, it.c);
  }
  im.instanceMatrix.needsUpdate = true;
  if (im.instanceColor) im.instanceColor.needsUpdate = true;
  im.castShadow = true;
  im.receiveShadow = true;
  im.frustumCulled = false; // instances span the map; base-geometry bounds would mis-cull
  im.name = name;
  return im;
}

// ---------------------------------------------------------- prop builders

/** Two-wheel farm cart tipped forward onto its shafts. ~2.8 m long, +X = front. */
function cartGeometry(rng: Rng): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const wr = 0.6; // wheel radius
  const pitch = rng.range(0.15, 0.24);

  for (const s of [-1, 1]) {
    const cz = s * 0.78;
    const rim = paint(new TorusGeometry(0.55, 0.05, 6, 15), IRON_DARK, rng, 0.07);
    parts.push(place(rim, 0, wr, cz));
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2 + rng.range(-0.03, 0.03);
      const sp = paint(new CylinderGeometry(0.022, 0.03, 0.46, 5, 1, true), WOOD_OAK, rng, 0.1);
      parts.push(place(sp, -Math.sin(a) * 0.27, wr + Math.cos(a) * 0.27, cz, 0, 0, a));
    }
    const hub = paint(new CylinderGeometry(0.08, 0.08, 0.17, 7), WOOD_DARK, rng, 0.08);
    parts.push(place(hub, 0, wr, cz, Math.PI / 2, 0, 0));
  }
  const axle = paint(new CylinderGeometry(0.048, 0.048, 1.58, 6, 1, true), WOOD_DARK, rng, 0.06);
  parts.push(place(axle, 0, wr, 0, Math.PI / 2, 0, 0));

  // bed + rails + stakes, pitched forward around the axle
  const bed: BufferGeometry[] = [];
  for (let i = 0; i < 5; i++) {
    const z = -0.44 + i * 0.22;
    const plank = paint(new BoxGeometry(1.68 + rng.range(-0.06, 0.06), 0.045, 0.2), WOOD_OAK, rng, 0.13);
    bed.push(place(plank, -0.06, 0.7 + rng.range(-0.01, 0.01), z));
  }
  for (const s of [-1, 1]) {
    for (const railY of [0.8, 0.97]) {
      const rail = paint(new BoxGeometry(1.68, 0.09, 0.035), WOOD_OAK, rng, 0.13);
      bed.push(place(rail, -0.06, railY + rng.range(-0.008, 0.008), s * 0.55));
    }
    for (const sx of [-0.72, -0.05, 0.62]) {
      const stake = paint(new BoxGeometry(0.045, 0.36, 0.05), WOOD_DARK, rng, 0.1);
      bed.push(place(stake, sx + rng.range(-0.02, 0.02), 0.885, s * 0.55));
    }
  }
  for (const gateY of [0.8, 0.97]) {
    const gate = paint(new BoxGeometry(0.035, 0.09, 1.08), WOOD_OAK, rng, 0.13);
    bed.push(place(gate, -0.92, gateY, 0));
  }
  const pitchM = new Matrix4().makeTranslation(0, wr, 0);
  pitchM.multiply(_m.makeRotationZ(-pitch));
  pitchM.multiply(_m.makeTranslation(0, -wr, 0));
  for (const g of bed) {
    g.applyMatrix4(pitchM);
    parts.push(g);
  }

  // shafts resting on the ground ahead of the tipped bed
  for (const s of [-1, 1]) {
    const shaft = paint(new CylinderGeometry(0.03, 0.037, 1.3, 5, 1, true), WOOD_OAK, rng, 0.1);
    parts.push(place(shaft, 1.35, 0.31, s * 0.37, 0, s * 0.05, -Math.PI / 2 - 0.4));
  }
  return mergeSafe(parts);
}

/** Slatted 0.7 m crate with corner posts and a stencil-dark patch on +Z. */
function crateArchetype(rng: Rng): BufferGeometry {
  const parts: BufferGeometry[] = [];
  for (const px of [-0.31, 0.31]) {
    for (const pz of [-0.31, 0.31]) {
      parts.push(place(paint(new BoxGeometry(0.07, 0.72, 0.07), WOOD_DARK, rng, 0.08), px, 0.36, pz));
    }
  }
  for (const y of [0.14, 0.37, 0.6]) {
    for (const side of [-1, 1]) {
      const segs = side > 0 ? 4 : 1; // +Z face is subdivided so the stencil reads
      const slatZ = paint(new BoxGeometry(0.61, 0.185, 0.04, segs, 1, 1), WOOD_PALE, rng, 0.12);
      parts.push(place(slatZ, rng.range(-0.012, 0.012), y + rng.range(-0.008, 0.008), side * 0.33));
      const slatX = paint(new BoxGeometry(0.04, 0.185, 0.61), WOOD_PALE, rng, 0.12);
      parts.push(place(slatX, side * 0.33, y + rng.range(-0.008, 0.008), rng.range(-0.012, 0.012)));
    }
  }
  for (const x of [-0.22, 0, 0.22]) {
    const lid = paint(new BoxGeometry(0.2, 0.04, 0.68), WOOD_PALE, rng, 0.12);
    parts.push(place(lid, x, 0.74, 0, 0, 0, rng.range(-0.012, 0.012)));
  }
  for (const z of [-0.24, 0.24]) {
    parts.push(place(paint(new BoxGeometry(0.7, 0.05, 0.09), WOOD_DARK, rng, 0.1), 0, 0.025, z));
  }
  const merged = mergeSafe(parts);
  darkenWhere(merged, 0.55, (x, y, z) => z > 0.3 && Math.abs(x - 0.05) < 0.17 && y > 0.25 && y < 0.55);
  return merged;
}

/** Staved barrel with bulge and dark iron hoops. */
function barrelArchetype(rng: Rng): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const staves = rng.int(12, 14);
  const rBase = 0.3;
  const bulge = 0.05;
  const h = 0.92;
  const w = (Math.PI * 2 * (rBase + bulge)) / staves + 0.006;
  for (let i = 0; i < staves; i++) {
    const g = new BoxGeometry(w, h, 0.036, 1, 2, 1);
    const pos = attr(g, 'position');
    for (let v = 0; v < pos.count; v++) {
      if (Math.abs(pos.getY(v)) < 0.01) pos.setZ(v, pos.getZ(v) + bulge);
      else pos.setX(v, pos.getX(v) * 0.9);
    }
    g.computeVertexNormals();
    paint(g, rng.chance(0.3) ? WOOD_GRAY : WOOD_OAK, rng, 0.14);
    const a = ((i + rng.range(-0.05, 0.05)) / staves) * Math.PI * 2;
    parts.push(place(g, Math.sin(a) * rBase, h / 2, Math.cos(a) * rBase, 0, a, 0));
  }
  const lid = paint(new CircleGeometry(rBase * 0.96, 12), WOOD_GRAY, rng, 0.1);
  parts.push(place(lid, 0, h - 0.05, 0, -Math.PI / 2, 0, 0));
  for (const [hy, hr] of [
    [0.12, rBase + 0.028],
    [h / 2, rBase + bulge + 0.024],
    [0.8, rBase + 0.028],
  ] as const) {
    const hoop = paint(new TorusGeometry(hr, 0.013, 3, 18), IRON_DARK, rng, 0.08);
    parts.push(place(hoop, 0, hy, 0, Math.PI / 2, 0, 0));
  }
  return mergeSafe(parts);
}

/** 7 m tapered telephone pole with crossarm, insulators and braces. */
function poleArchetype(rng: Rng): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const shaft = paint(new CylinderGeometry(0.075, 0.135, 7.4, 7, 1), WOOD_GRAY, rng, 0.08);
  parts.push(place(shaft, 0, 3.7, 0));
  const arm = paint(new BoxGeometry(0.08, 0.1, 1.7), WOOD_GRAY, rng, 0.1);
  parts.push(place(arm, 0, 6.78, 0, 0, 0, rng.range(-0.02, 0.02)));
  for (const z of [-0.72, -0.36, 0.36, 0.72]) {
    const knob = paint(new CylinderGeometry(0.03, 0.045, 0.12, 5), CERAMIC, rng, 0.1);
    parts.push(place(knob, 0, 6.9, z));
  }
  for (const s of [-1, 1]) {
    const brace = paint(new BoxGeometry(0.04, 0.55, 0.04), WOOD_GRAY, rng, 0.1);
    parts.push(place(brace, 0, 6.48, s * 0.26, s * 0.6, 0, 0));
  }
  return mergeSafe(parts);
}

/** Roadside fingerpost: post + 2-3 pointed arrow boards at differing yaws. */
function signGeometry(rng: Rng): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const lean = rng.range(-0.04, 0.04);
  const post = paint(new CylinderGeometry(0.05, 0.07, 2.5, 6), WOOD_GRAY, rng, 0.1);
  parts.push(place(post, 0, 1.25, 0, lean, 0, lean * 0.7));
  const n = rng.int(2, 3);
  const yaws = [0, Math.PI + rng.range(-0.6, 0.6), rng.range(1.1, 2.1) * (rng.chance(0.5) ? 1 : -1)];
  for (let b = 0; b < n; b++) {
    const board = new BoxGeometry(0.86, 0.17, 0.035, 4, 1, 1);
    const pos = attr(board, 'position');
    for (let i = 0; i < pos.count; i++) {
      if (pos.getX(i) > 0.42) pos.setY(i, pos.getY(i) * 0.12); // pointed tip
    }
    board.computeVertexNormals();
    paint(board, CREAM, rng, 0.08, 0.03);
    darkenWhere(board, 0.42, (x, y) => Math.abs(y) > 0.064 || x > 0.36 || x < -0.41);
    board.translate(0.46, 0, 0.055);
    parts.push(place(board, 0, 2.28 - b * 0.32, 0, rng.range(-0.03, 0.03), yaws[b] ?? 0, rng.range(-0.04, 0.04)));
  }
  return mergeSafe(parts);
}

/** Unit rubble chunk: a corner-jittered box (hull stays closed). */
function rubbleChunkArchetype(rng: Rng): BufferGeometry {
  const g = new BoxGeometry(1, 1, 1);
  const pos = attr(g, 'position');
  const off: number[] = [];
  for (let i = 0; i < 24; i++) off.push(rng.range(-0.22, 0.22));
  for (let i = 0; i < pos.count; i++) {
    const key = ((pos.getX(i) > 0 ? 1 : 0) | (pos.getY(i) > 0 ? 2 : 0) | (pos.getZ(i) > 0 ? 4 : 0)) * 3;
    pos.setXYZ(i, pos.getX(i) + (off[key] ?? 0), pos.getY(i) + (off[key + 1] ?? 0), pos.getZ(i) + (off[key + 2] ?? 0));
  }
  g.computeVertexNormals();
  paint(g, 0xffffff, rng.fork('faces'), 0.06, 0.06); // near-white; instance color carries hue
  return g;
}

/** Dry-stone well ring, two posts, gable roof, crossbar, bucket. */
function wellGeometry(rng: Rng): BufferGeometry {
  const parts: BufferGeometry[] = [];
  for (const [count, radius, y, bw, bh, bd, phase] of [
    [12, 0.72, 0.2, 0.4, 0.4, 0.3, 0],
    [10, 0.7, 0.55, 0.46, 0.3, 0.27, 0.31],
  ] as const) {
    for (let i = 0; i < count; i++) {
      const a = ((i + rng.range(-0.1, 0.1)) / count) * Math.PI * 2 + phase;
      const blk = paint(new BoxGeometry(bw * rng.range(0.85, 1.15), bh * rng.range(0.85, 1.1), bd), STONE_GRAY, rng, 0.16);
      parts.push(place(blk, Math.sin(a) * radius, y + rng.range(-0.03, 0.03), Math.cos(a) * radius, 0, a + rng.range(-0.06, 0.06), 0));
    }
  }
  const pit = paint(new CircleGeometry(0.55, 10), PIT_DARK, rng, 0.03, 0.02);
  parts.push(place(pit, 0, 0.34, 0, -Math.PI / 2, 0, 0));
  for (const s of [-1, 1]) {
    const post = paint(new BoxGeometry(0.1, 1.7, 0.12), WOOD_DARK, rng, 0.1);
    parts.push(place(post, s * 0.8, 1.35, 0, 0, 0, s * -0.02));
    const roof = paint(new BoxGeometry(1.9, 0.045, 0.75), WOOD_GRAY, rng, 0.12);
    parts.push(place(roof, 0, 2.22, s * 0.3, s * 0.62, 0, 0));
  }
  const ridge = paint(new BoxGeometry(1.92, 0.06, 0.1), WOOD_DARK, rng, 0.1);
  parts.push(place(ridge, 0, 2.38, 0));
  const bar = paint(new CylinderGeometry(0.045, 0.045, 1.75, 6, 1, true), WOOD_OAK, rng, 0.08);
  parts.push(place(bar, 0, 1.98, 0, 0, 0, Math.PI / 2));
  const crank = paint(new CylinderGeometry(0.02, 0.02, 0.26, 4, 1, true), IRON_DARK, rng, 0.06);
  parts.push(place(crank, 0.94, 1.98, 0.09, Math.PI / 2, 0, 0));
  const bx = rng.range(-0.15, 0.15);
  const bz = rng.range(-0.15, 0.15);
  const rope = paint(new CylinderGeometry(0.012, 0.012, 0.78, 4, 1, true), ROPE, rng, 0.05);
  parts.push(place(rope, bx, 1.59, bz));
  const bucket = paint(new CylinderGeometry(0.1, 0.085, 0.17, 8, 1, false), WOOD_DARK, rng, 0.1);
  parts.push(place(bucket, bx, 1.12, bz));
  return mergeSafe(parts);
}

/** Rounded, noise-displaced haystack cone with a tilted crown. */
function haystackArchetype(rng: Rng): BufferGeometry {
  const g = new ConeGeometry(1.15, 2.05, 10, 5, true);
  g.translate(0, 1.025, 0);
  const sd = rng.int(1, 1 << 30);
  const leanA = rng.range(0, Math.PI * 2);
  const pos = attr(g, 'position');
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const t = Math.min(0.999, Math.max(0, y / 2.05));
    const r = Math.hypot(x, z);
    let nx = 0;
    let nz = 0;
    if (r > 1e-5) {
      nx = x / r;
      nz = z / r;
    }
    const dome = Math.pow(Math.cos(t * Math.PI * 0.5), 0.72);
    const n1 = valueNoise2D(nx * 1.6 + 7.3, nz * 1.6 + t * 2.6, sd);
    const newR = 1.15 * dome * (0.9 + 0.22 * n1);
    const yJit = (valueNoise2D(nx * 2.1, nz * 2.1 + 9.7, sd ^ 0x2f) - 0.5) * 0.16 * (1 - t);
    pos.setXYZ(i, nx * newR + t * t * Math.cos(leanA) * 0.2, y + yJit, nz * newR + t * t * Math.sin(leanA) * 0.2);
  }
  g.computeVertexNormals();
  const col = new Float32Array(pos.count * 3);
  _c.setHex(STRAW);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const v = 0.72 + 0.28 * Math.min(1, Math.max(0, y) / 1.9) + (valueNoise2D(x * 2.4, z * 2.4 + y * 3.1, sd ^ 0x51) - 0.5) * 0.3;
    col[i * 3] = _c.r * v * 1.04;
    col[i * 3 + 1] = _c.g * v;
    col[i * 3 + 2] = _c.b * v * 0.92;
  }
  g.setAttribute('color', new BufferAttribute(col, 3));
  return g;
}

/** Hollow stone/wood watering trough with a dark wet interior bottom. */
function troughGeometry(rng: Rng): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const stone = rng.chance(0.55);
  const hex = stone ? STONE_GRAY : WOOD_DARK;
  const L = 1.62 + rng.range(-0.15, 0.2);
  const W = 0.6;
  const H = 0.46;
  const th = stone ? 0.085 : 0.06;
  for (const s of [-1, 1]) {
    const foot = paint(new BoxGeometry(0.12, 0.1, W + 0.04), hex, rng, 0.12);
    parts.push(place(foot, s * (L / 2 - 0.22), 0.05, 0));
  }
  const bottom = paint(new BoxGeometry(L, th, W), hex, rng, 0.12);
  parts.push(place(bottom, 0, 0.1 + th / 2, 0));
  for (const s of [-1, 1]) {
    const wall = paint(new BoxGeometry(L, H - 0.1, th), hex, rng, 0.12);
    parts.push(place(wall, 0, 0.1 + (H - 0.1) / 2, (s * (W - th)) / 2, s * -0.03, 0, 0));
    const end = paint(new BoxGeometry(th, H - 0.1, W - th * 2), hex, rng, 0.12);
    parts.push(place(end, (s * (L - th)) / 2, 0.1 + (H - 0.1) / 2, 0, 0, 0, s * 0.02));
  }
  const wet = paint(new BoxGeometry(L - th * 2.2, 0.02, W - th * 2.2), WET_DARK, rng, 0.05, 0.02);
  parts.push(place(wet, 0, 0.1 + th + 0.012, 0));
  return mergeSafe(parts);
}

// ------------------------------------------------------------- main entry

export function buildProps(model: WorldModel, ground: Ground): Group {
  const group = new Group();
  group.name = 'props';

  const carts: PropSpec[] = [];
  const crates: PropSpec[] = [];
  const barrels: PropSpec[] = [];
  const poles: PropSpec[] = [];
  const signs: PropSpec[] = [];
  const rubblePiles: PropSpec[] = [];
  const wells: PropSpec[] = [];
  const haystacks: PropSpec[] = [];
  const troughs: PropSpec[] = [];
  for (const p of model.props) {
    switch (p.kind) {
      case 'cart':
        carts.push(p);
        break;
      case 'crate':
        crates.push(p);
        break;
      case 'barrel':
        barrels.push(p);
        break;
      case 'pole':
        poles.push(p);
        break;
      case 'sign':
        signs.push(p);
        break;
      case 'rubble':
        rubblePiles.push(p);
        break;
      case 'well':
        wells.push(p);
        break;
      case 'haystack':
        haystacks.push(p);
        break;
      case 'trough':
        troughs.push(p);
        break;
      default:
        break; // tree-* / bush handled by the vegetation module
    }
  }

  const arch = new Rng((model.seed ^ 0x9d0757) >>> 0);

  // ---- low-count bespoke props → one merged static mesh (1 draw call)
  const staticGeos: BufferGeometry[] = [];
  for (const s of carts) {
    const rng = new Rng(s.seed);
    const g = cartGeometry(rng);
    g.applyMatrix4(worldMatrix(s, ground, rng, { sink: 0.045, tilt: 0.8, lean: 0 }));
    staticGeos.push(g);
  }
  for (const s of signs) {
    const rng = new Rng(s.seed);
    const g = signGeometry(rng);
    g.applyMatrix4(worldMatrix(s, ground, rng, { sink: 0.06, tilt: 0, lean: 0.02 }));
    staticGeos.push(g);
  }
  for (const s of wells) {
    const rng = new Rng(s.seed);
    const g = wellGeometry(rng);
    g.applyMatrix4(worldMatrix(s, ground, rng, { sink: 0.08, tilt: 0, lean: 0 }));
    staticGeos.push(g);
  }
  for (const s of troughs) {
    const rng = new Rng(s.seed);
    const g = troughGeometry(rng);
    g.applyMatrix4(worldMatrix(s, ground, rng, { sink: 0.04, tilt: 0.75, lean: 0.02 }));
    staticGeos.push(g);
  }
  if (staticGeos.length > 0) {
    const mesh = new Mesh(mergeSafe(staticGeos), MAT_PROP);
    mesh.name = 'props-static';
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  // ---- crates: two archetype variants
  const crateArchs = [crateArchetype(arch.fork('crate-a')), crateArchetype(arch.fork('crate-b'))];
  const crateItems: InstanceItem[][] = [[], []];
  crates.forEach((s, idx) => {
    const rng = new Rng(s.seed);
    const list = crateItems[idx % 2];
    if (!list) return;
    list.push({
      m: worldMatrix(s, ground, rng, { sink: 0.025, tilt: 0.5, lean: 0.035 }).clone(),
      c: jitterTint(rng, 0.14),
    });
  });
  crateArchs.forEach((g, i) => {
    const items = crateItems[i] ?? [];
    if (items.length > 0) group.add(makeInstanced(`props-crates-${i}`, g, MAT_PROP, items));
    else g.dispose();
  });

  // ---- barrels: one archetype, occasional topple
  const barrelArch = barrelArchetype(arch.fork('barrel'));
  const barrelItems: InstanceItem[] = [];
  for (const s of barrels) {
    const rng = new Rng(s.seed);
    let m: Matrix4;
    if (rng.chance(0.16)) {
      _qYaw.setFromEuler(_e.set(0, -s.rotation + rng.range(-0.4, 0.4), 0));
      _qLean.setFromEuler(_e.set(Math.PI / 2 + rng.range(-0.06, 0.06), 0, 0));
      _q.multiplyQuaternions(_qYaw, _qLean);
      _vPos.set(s.x, ground.height(s.x, s.z) + 0.33 * s.scale, s.z);
      _vScl.set(s.scale, s.scale, s.scale);
      m = _mW.compose(_vPos, _q, _vScl).clone();
    } else {
      m = worldMatrix(s, ground, rng, { sink: 0.03, tilt: 0.35, lean: 0.03 }).clone();
    }
    barrelItems.push({ m, c: jitterTint(rng, 0.13) });
  }
  if (barrelItems.length > 0) group.add(makeInstanced('props-barrels', barrelArch, MAT_PROP, barrelItems));
  else barrelArch.dispose();

  // ---- telephone poles
  const poleArch = poleArchetype(arch.fork('pole'));
  const poleItems: InstanceItem[] = [];
  for (const s of poles) {
    const rng = new Rng(s.seed);
    poleItems.push({
      m: worldMatrix(s, ground, rng, { sink: 0.3, tilt: 0, lean: 0.028 }).clone(),
      c: jitterTint(rng, 0.09),
    });
  }
  if (poleItems.length > 0) group.add(makeInstanced('props-poles', poleArch, MAT_PROP, poleItems));
  else poleArch.dispose();

  // ---- haystacks: two variants, non-uniform per-instance scale
  const hayArchs = [haystackArchetype(arch.fork('hay-a')), haystackArchetype(arch.fork('hay-b'))];
  const hayItems: InstanceItem[][] = [[], []];
  haystacks.forEach((s, idx) => {
    const rng = new Rng(s.seed);
    const list = hayItems[idx % 2];
    if (!list) return;
    const o: PlaceOpts = {
      sink: 0.1,
      tilt: 0.55,
      lean: 0.02,
      sx: rng.range(0.88, 1.14),
      sy: rng.range(0.86, 1.1),
      sz: rng.range(0.88, 1.14),
    };
    list.push({ m: worldMatrix(s, ground, rng, o).clone(), c: jitterTint(rng, 0.12) });
  });
  hayArchs.forEach((g, i) => {
    const items = hayItems[i] ?? [];
    if (items.length > 0) group.add(makeInstanced(`props-haystacks-${i}`, g, MAT_STRAW, items));
    else g.dispose();
  });

  // ---- rubble: gaussian-mounded, half-sunk instanced chunks, two variants
  const chunkArchs = [rubbleChunkArchetype(arch.fork('chunk-a')), rubbleChunkArchetype(arch.fork('chunk-b'))];
  const chunkItems: InstanceItem[][] = [[], []];
  for (const s of rubblePiles) {
    const rng = new Rng(s.seed);
    const R = s.scale * rng.range(0.7, 1.0);
    const n = rng.int(15, 25);
    for (let i = 0; i < n; i++) {
      const ang = rng.range(0, Math.PI * 2);
      const rad = Math.min(Math.abs(rng.gaussian(0, R * 0.5)), R * 1.25);
      const cx = s.x + Math.cos(ang) * rad;
      const cz = s.z + Math.sin(ang) * rad;
      const base = s.scale * rng.range(0.17, 0.5);
      const sx = base * rng.range(0.8, 1.6);
      const sy = base * rng.range(0.5, 1.0);
      const sz = base * rng.range(0.8, 1.6);
      const mound = Math.max(0, 1 - (rad / (R * 1.25)) ** 2);
      const y = ground.height(cx, cz) + sy * rng.range(-0.1, 0.42) + mound * 0.26 * s.scale * rng.float();
      _q.setFromEuler(_e.set(rng.range(0, Math.PI), rng.range(0, Math.PI * 2), rng.range(0, Math.PI)));
      _vPos.set(cx, y, cz);
      _vScl.set(sx, sy, sz);
      const roll = rng.float();
      const hexC = roll < 0.3 ? BRICK : roll < 0.58 ? PLASTER : roll < 0.85 ? STONE_GRAY : CHARRED;
      _c.setHex(hexC);
      const v = rng.range(0.78, 1.12);
      const list = chunkItems[i % 2];
      if (list) {
        list.push({ m: _mW.compose(_vPos, _q, _vScl).clone(), c: new Color(_c.r * v, _c.g * v, _c.b * v) });
      }
    }
  }
  chunkArchs.forEach((g, i) => {
    const items = chunkItems[i] ?? [];
    if (items.length > 0) group.add(makeInstanced(`props-rubble-${i}`, g, MAT_PROP, items));
    else g.dispose();
  });

  return group;
}
