/**
 * TerrainMesh — the playable-area ground surface (|x|,|z| ≤ 800 m) built as
 * two concentric resolution rings of vertex-coloured chunk meshes:
 *
 *  - inner ring: square |x|,|z| ≤ 336 m at 2 m vertex spacing (3 m on 'low'),
 *    split into 4×4 chunks;
 *  - outer ring: the full 800 m half-extent grid at ~6 m spacing (~9 m on
 *    'low'), split into 4×4 chunks, skipping quads whose centre lies inside
 *    the inner square minus a 6 m overlap band. The overlap band's Y sinks
 *    6 cm so the finer inner ring wins visually and T-junction cracks are
 *    impossible.
 *
 * Every vertex takes its height from Ground.height(x,z) and its colour from
 * the ground classification (roads with wheel ruts, crater scorch, crop
 * fields with row striping, grass verge) plus fBm tonal variation and a
 * large-scale domain-warped moisture tint — the Normandy patchwork reads
 * from any altitude without a single texture. Vertices are jittered
 * in-plane, keyed on the lattice position, so the regular grid never shows
 * while neighbouring chunks still produce bit-identical shared vertices.
 * Deterministic: all noise/hash seeds derive from model.seed ^ constants.
 */

import { BufferAttribute, BufferGeometry, Group, Mesh } from 'three';
import type { GraphicsPreset } from '../app/Config.ts';
import { lerp } from '../core/MathUtil.ts';
import { fbm2D, warped2D } from '../core/Noise.ts';
import { hash2D } from '../core/Random.ts';
import { detailedMaterial } from '../render/MaterialDetail.ts';
import type { Ground } from './Ground.ts';
import { PLAY_HALF } from './WorldConst.ts';
import type { CropKind, WorldModel } from './WorldTypes.ts';

/** Half-extent of the high-resolution inner ring (m). */
const INNER_HALF = 336;
/** Outer-ring quads survive this far into the inner square (m). */
const OVERLAP = 6;
/** The overlap band sinks by this much so the inner ring renders on top. */
const Y_DROP = 0.06;
/** Chunk grid per ring: 4×4 inner + 4×4 outer = 32 draw calls. */
const CHUNKS = 4;

type Rgb = readonly [number, number, number];

// Muted late-summer meadow (the reference reads olive/sage, never lime).
const GRASS: Rgb = [0.255, 0.3, 0.15];
/** sun-dried worn grass — patches lerp toward this to break the carpet */
const DRY: Rgb = [0.4, 0.35, 0.185];
const SCORCH: Rgb = [0.23, 0.2, 0.17];
const MOISTURE: Rgb = [0.24, 0.285, 0.175];

const CROP_COLORS: Record<CropKind, Rgb> = {
  wheat: [0.62, 0.54, 0.3],
  hay: [0.58, 0.52, 0.34],
  pasture: [0.33, 0.385, 0.2],
  plow: [0.4, 0.32, 0.24],
  orchard: [0.32, 0.375, 0.195],
};

/** One material shared by all 32 chunks — a single pipeline for the ground.
 *  detailedMaterial adds the macro/meso/micro bands + bump relief the rest
 *  of the world already carries (the terrain was the last flat surface). */
const terrainMaterial = detailedMaterial('terrain', { roughness: 0.96 });
terrainMaterial.name = 'terrain';

interface ChunkSpec {
  x0: number;
  z0: number;
  /** Chunk edge length (m); chunks are square. */
  span: number;
  /** Target vertex spacing (m); actual step = span / round(span / spacing). */
  spacing: number;
  /** Half-extent of the whole ring — jitter is pinned on the ring boundary. */
  ringHalf: number;
  /** Outer-ring chunks skip quads under the inner ring + sink the overlap. */
  outer: boolean;
}

/**
 * Baked occlusion field: a coarse occupancy grid of buildings/walls/hedges.
 * Terrain vertices near structures darken (grounding "contact" shading) so
 * buildings sit IN the world instead of floating on flat-lit grass.
 */
const AO_CELL = 2;
const AO_N = Math.ceil((PLAY_HALF * 2) / AO_CELL);

function buildAoField(model: WorldModel): Uint8Array {
  const occ = new Uint8Array(AO_N * AO_N);
  const stamp = (x: number, z: number): void => {
    const cx = Math.floor((x + PLAY_HALF) / AO_CELL);
    const cz = Math.floor((z + PLAY_HALF) / AO_CELL);
    if (cx >= 0 && cz >= 0 && cx < AO_N && cz < AO_N) occ[cz * AO_N + cx] = 1;
  };
  for (const b of model.buildings) {
    const cos = Math.cos(b.rotation);
    const sin = Math.sin(b.rotation);
    for (let lx = -b.halfW - 0.5; lx <= b.halfW + 0.5; lx += AO_CELL * 0.6) {
      for (let lz = -b.halfD - 0.5; lz <= b.halfD + 0.5; lz += AO_CELL * 0.6) {
        stamp(b.x + lx * cos - lz * sin, b.z + lx * sin + lz * cos);
      }
    }
  }
  for (const s of model.barriers) {
    if (s.kind === 'fence') continue;
    const len = Math.hypot(s.x1 - s.x0, s.z1 - s.z0);
    const steps = Math.max(1, Math.ceil(len / (AO_CELL * 0.6)));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      stamp(s.x0 + (s.x1 - s.x0) * t, s.z0 + (s.z1 - s.z0) * t);
    }
  }
  return occ;
}

/** 0 (fully occluded base) … 1 (open ground). Scans a 2-cell ring. */
function aoAt(occ: Uint8Array, x: number, z: number): number {
  const cx = Math.floor((x + PLAY_HALF) / AO_CELL);
  const cz = Math.floor((z + PLAY_HALF) / AO_CELL);
  let minD = 9;
  for (let dz = -2; dz <= 2; dz++) {
    for (let dx = -2; dx <= 2; dx++) {
      const nx = cx + dx;
      const nz = cz + dz;
      if (nx < 0 || nz < 0 || nx >= AO_N || nz >= AO_N) continue;
      if (occ[nz * AO_N + nx] === 1) {
        const d = Math.hypot(dx, dz);
        if (d < minD) minD = d;
      }
    }
  }
  if (minD > 2.5) return 1;
  // 0.55 at the wall base → 1.0 at ~5 m out
  return 0.55 + 0.45 * Math.min(1, minD / 2.5);
}

export function buildTerrain(model: WorldModel, ground: Ground, preset: GraphicsPreset): Group {
  const group = new Group();
  group.name = 'terrain';
  const seed = model.seed;
  const aoField = buildAoField(model);
  const innerSpacing = preset === 'low' ? 3 : 2;
  const outerSpacing = preset === 'low' ? 9 : 6;
  const innerSpan = (INNER_HALF * 2) / CHUNKS;
  const outerSpan = (PLAY_HALF * 2) / CHUNKS;

  for (let cz = 0; cz < CHUNKS; cz++) {
    for (let cx = 0; cx < CHUNKS; cx++) {
      const inner = buildChunk(ground, seed, aoField, {
        x0: -INNER_HALF + cx * innerSpan,
        z0: -INNER_HALF + cz * innerSpan,
        span: innerSpan,
        spacing: innerSpacing,
        ringHalf: INNER_HALF,
        outer: false,
      });
      inner.name = `terrain-inner-${cx}-${cz}`;
      group.add(inner);

      const outer = buildChunk(ground, seed, aoField, {
        x0: -PLAY_HALF + cx * outerSpan,
        z0: -PLAY_HALF + cz * outerSpan,
        span: outerSpan,
        spacing: outerSpacing,
        ringHalf: PLAY_HALF,
        outer: true,
      });
      outer.name = `terrain-outer-${cx}-${cz}`;
      group.add(outer);
    }
  }
  return group;
}

function buildChunk(ground: Ground, seed: number, aoField: Uint8Array, spec: ChunkSpec): Mesh {
  const { x0, z0, span, outer } = spec;
  const n = Math.max(1, Math.round(span / spec.spacing));
  const step = span / n;
  const vpr = n + 1; // vertices per row
  const positions = new Float32Array(vpr * vpr * 3);
  const colors = new Float32Array(vpr * vpr * 3);
  // Max in-plane displacement: two neighbours approach at most 0.54·step,
  // so quads can never fold, yet the grid pattern dissolves completely.
  const jitterAmp = step * 0.27;

  for (let j = 0; j <= n; j++) {
    const lz = z0 + j * step;
    for (let i = 0; i <= n; i++) {
      const lx = x0 + i * step;
      let x = lx;
      let z = lz;
      // Jitter keyed on the lattice position (quantised world coords) so
      // adjacent chunks emit identical shared-edge vertices; the ring's
      // outermost boundary stays pinned to keep ring-to-ring layering exact.
      if (Math.max(Math.abs(lx), Math.abs(lz)) < spec.ringHalf - 0.01) {
        const kx = Math.round(lx * 8);
        const kz = Math.round(lz * 8);
        x += (hash2D(kx, kz, seed ^ 0x9e3b) * 2 - 1) * jitterAmp;
        z += (hash2D(kx, kz, seed ^ 0x71f7) * 2 - 1) * jitterAmp;
      }
      let y = ground.height(x, z);
      // Overlap band: the outer ring ducks under the inner ring.
      if (outer && Math.max(Math.abs(x), Math.abs(z)) < INNER_HALF) y -= Y_DROP;
      const o = (j * vpr + i) * 3;
      positions[o] = x;
      positions[o + 1] = y;
      positions[o + 2] = z;
      paintVertex(colors, o, x, z, ground, seed, aoField);
    }
  }

  const indices: number[] = [];
  const skipHalf = INNER_HALF - OVERLAP;
  for (let j = 0; j < n; j++) {
    const czc = z0 + (j + 0.5) * step;
    for (let i = 0; i < n; i++) {
      if (outer) {
        const cxc = x0 + (i + 0.5) * step;
        if (Math.abs(cxc) < skipHalf && Math.abs(czc) < skipHalf) continue;
      }
      const a = j * vpr + i;
      const b = a + 1;
      const c = a + vpr;
      const d = c + 1;
      // Alternate the split diagonal — kills the uniform tessellation shear.
      if ((i + j) % 2 === 0) indices.push(a, c, b, b, c, d);
      else indices.push(a, d, b, a, c, d);
    }
  }

  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(positions, 3));
  geo.setAttribute('color', new BufferAttribute(colors, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();

  // Perimeter vertices only see triangles on one side, so their computed
  // normals would seam against the neighbouring chunk. Replace them with the
  // analytic ground normal — identical for both chunks sharing the edge.
  const normalAttr = geo.getAttribute('normal') as BufferAttribute;
  const nrm = { x: 0, y: 0, z: 0 };
  const fixNormal = (v: number): void => {
    const px = positions[v * 3] ?? 0;
    const pz = positions[v * 3 + 2] ?? 0;
    ground.normal(px, pz, nrm);
    normalAttr.setXYZ(v, nrm.x, nrm.y, nrm.z);
  };
  for (let i = 0; i <= n; i++) {
    fixNormal(i);
    fixNormal(n * vpr + i);
  }
  for (let j = 1; j < n; j++) {
    fixNormal(j * vpr);
    fixNormal(j * vpr + n);
  }
  normalAttr.needsUpdate = true;
  geo.computeBoundingSphere();

  const mesh = new Mesh(geo, terrainMaterial);
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  return mesh;
}

/**
 * Classify one vertex into the Normandy palette: crop fields (with row
 * striping), road surface (with wheel ruts), crater scorch, then fBm tonal
 * variation, a large-scale moisture tint and a per-vertex micro jitter.
 */
function paintVertex(out: Float32Array, o: number, x: number, z: number, ground: Ground, seed: number, aoField: Uint8Array): void {
  let r = GRASS[0];
  let g = GRASS[1];
  let b = GRASS[2];

  const field = ground.fieldAt(x, z);
  if (field) {
    const crop = CROP_COLORS[field.crop];
    r = crop[0];
    g = crop[1];
    b = crop[2];
    if (field.crop === 'plow' || field.crop === 'wheat') {
      const row = (x * Math.cos(field.rowDir) + z * Math.sin(field.rowDir)) / 3.2;
      if (row - Math.floor(row) < 0.45) {
        r *= 0.9;
        g *= 0.9;
        b *= 0.9;
      }
    }
  }

  // Roads have a dedicated draped mesh (RoadMesh.ts); the terrain underneath
  // becomes a worn dirt shoulder so the road edges read as trodden verges.
  const m = ground.roadMask(x, z);
  if (m > 0.002) {
    // dark trodden-earth shoulder so the light road strip pops against it
    const shoulder = Math.min(0.9, m * 1.3);
    r = lerp(r, 0.27, shoulder);
    g = lerp(g, 0.225, shoulder);
    b = lerp(b, 0.155, shoulder);
  }

  // Village yards: worn, drier trodden ground with organic patchiness.
  const villR = Math.hypot(x, z);
  if (villR < 280) {
    const vill = (1 - villR / 280) * (0.25 + 0.55 * warped2D(x * 0.02, z * 0.02, seed ^ 0x1274, 1.4, 3));
    r = lerp(r, 0.45, vill * 0.5);
    g = lerp(g, 0.4, vill * 0.5);
    b = lerp(b, 0.26, vill * 0.5);
  }

  const c = ground.craterMask(x, z);
  if (c > 0.002) {
    const k = c * 0.85;
    r = lerp(r, SCORCH[0], k);
    g = lerp(g, SCORCH[1], k);
    b = lerp(b, SCORCH[2], k);
  }

  // Sun-dried worn patches — the meadow must never read as one green carpet.
  const dryRaw = warped2D(x * 0.013, z * 0.013, seed ^ 0x0d27, 1.6, 3);
  const dry = Math.max(0, (dryRaw - 0.52) * 2.4);
  if (!field && dry > 0) {
    r = lerp(r, DRY[0], Math.min(0.75, dry));
    g = lerp(g, DRY[1], Math.min(0.75, dry));
    b = lerp(b, DRY[2], Math.min(0.75, dry));
  }

  // Organic tonal variation everywhere — kills flat-looking ground.
  const tone = 0.74 + 0.5 * fbm2D(x * 0.05, z * 0.05, seed ^ 0x5eed, 3);
  r *= tone;
  g *= tone;
  b *= tone;

  // Large-scale moisture patches drifting toward a darker damp green.
  const moist = warped2D(x * 0.004, z * 0.004, seed ^ 0x30f1, 1.5, 3) * 0.6;
  r = lerp(r, MOISTURE[0], moist);
  g = lerp(g, MOISTURE[1], moist);
  b = lerp(b, MOISTURE[2], moist);

  // Fine per-vertex jitter so no two neighbouring vertices match exactly.
  const micro = 0.95 + 0.1 * hash2D(Math.round(x * 5), Math.round(z * 5), seed ^ 0x1e55);

  // Baked grounding occlusion: darken toward structure bases.
  const ao = aoAt(aoField, x, z);

  out[o] = Math.min(1, r * micro * ao);
  out[o + 1] = Math.min(1, g * micro * ao);
  out[o + 2] = Math.min(1, b * micro * ao);
}
