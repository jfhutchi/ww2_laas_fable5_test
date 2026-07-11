/**
 * Near-field ground cover: instanced grass clumps, roadside weeds, gravel
 * stones and small debris so the ground within camera range is geometry,
 * not bare texture (LAAS Pillar A). Density concentrates where cameras
 * live: road verges, the village bowl, and the southern approach.
 */

import {
  BufferAttribute,
  BufferGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  Quaternion,
  Vector3,
} from 'three';
import { Rng, hash2D } from '../core/Random.ts';
import { clamp01 } from '../core/MathUtil.ts';
import { detailedMaterial, leafCardMaterial } from '../render/MaterialDetail.ts';
import { attribute, positionLocal, sin, time, vec3 as tslVec3 } from 'three/tsl';
// TSL @types are narrower than runtime — loose bridges for vec construction
const v3 = tslVec3 as unknown as (x: unknown, y: unknown, z: unknown) => typeof positionLocal;
const attr3 = attribute as unknown as (name: string) => typeof positionLocal;
import { fbm2D } from '../core/Noise.ts';
import type { Ground } from '../world/Ground.ts';
import type { WorldModel } from '../world/WorldTypes.ts';
import { pointInPolygon, polygonCentroid } from '../world/WorldTypes.ts';
import type { GraphicsPreset } from '../app/Config.ts';

const MAT_GRASS = detailedMaterial('grass', { roughness: 0.95, doubleSide: true });
// wind: blades bend by local height squared (attribute('position') is the
// raw pre-instance vertex; positionLocal is already instance-transformed)
{
  const rawY = attr3('position').y;
  const flex = rawY.mul(rawY); // tip bends, base stays anchored (height²)
  const wx = positionLocal.x;
  const wz = positionLocal.z;
  // large world-coherent gust wave rolling downwind → visible bands of wind
  // sweeping across the whole sward (envelope ~0.22 … 1.22)
  const gust = sin(time.mul(0.85).sub(wx.mul(0.055)).sub(wz.mul(0.04))).mul(0.5).add(0.72);
  const phase = wx.add(wz).mul(0.5);
  const swayX = sin(time.mul(2.0).add(phase)).mul(flex).mul(gust).mul(0.36);
  const swayZ = sin(time.mul(2.6).add(phase.mul(1.7)).add(1.3)).mul(flex).mul(gust).mul(0.22);
  const leanX = flex.mul(gust).mul(0.2); // steady downwind lean, pulsing with gusts
  MAT_GRASS.positionNode = positionLocal.add(v3(swayX.add(leanX), 0, swayZ));
}
const MAT_STONE = detailedMaterial('stone', { roughness: 0.98 });

// roadside bushes share the photo leaf-card vocabulary of trees/hedges —
// solid icosphere blobs read as topiary beside them
const MAT_SHRUB = leafCardMaterial('bush');
{
  // whole-bush sway: gentler than grass, driven by the same gust field
  const rawY = attr3('position').y;
  const flex = rawY.mul(0.5).add(0.15);
  const wx = positionLocal.x;
  const wz = positionLocal.z;
  const gust = sin(time.mul(0.8).sub(wx.mul(0.05)).sub(wz.mul(0.04))).mul(0.5).add(0.7);
  const swayX = sin(time.mul(1.25).add(wx.add(wz).mul(0.4))).mul(flex).mul(gust).mul(0.12);
  const swayZ = sin(time.mul(1.6).add(wx.mul(0.5)).add(1.1)).mul(flex).mul(gust).mul(0.08);
  MAT_SHRUB.positionNode = positionLocal.add(v3(swayX, 0, swayZ));
}

const MAT_FLOWER = detailedMaterial('foliage', { roughness: 0.78, doubleSide: true });
{
  // flowers nod like tall grass (height² flex on the same gust field)
  const rawY = attr3('position').y;
  const flex = rawY.mul(rawY);
  const wx = positionLocal.x;
  const wz = positionLocal.z;
  const gust = sin(time.mul(0.85).sub(wx.mul(0.055)).sub(wz.mul(0.04))).mul(0.5).add(0.72);
  const swayX = sin(time.mul(1.9).add(wx.add(wz).mul(0.5))).mul(flex).mul(gust).mul(0.3);
  const swayZ = sin(time.mul(2.4).add(wx.mul(0.5)).add(1.3)).mul(flex).mul(gust).mul(0.18);
  MAT_FLOWER.positionNode = positionLocal.add(v3(swayX, 0, swayZ));
}

/** Grass tuft of thin tapering ribbon blades, base→sunlit-tip gradient. Up
 * normals so the sward reads as an evenly sunlit carpet, not dark spikes. */
function grassClump(rng: Rng): BufferGeometry {
  const positions: number[] = [];
  const colors: number[] = [];
  const normals: number[] = [];
  const blades = 9;
  for (let b = 0; b < blades; b++) {
    const ang = rng.range(0, Math.PI * 2);
    const dx = Math.cos(ang);
    const dz = Math.sin(ang);
    const h = rng.range(0.36, 0.84);
    const halfW = rng.range(0.016, 0.03); // thin blade
    const cx = rng.range(-0.16, 0.16);
    const cz = rng.range(-0.16, 0.16);
    const lean = rng.range(0.08, 0.34);
    const perpx = -dz * halfW;
    const perpz = dx * halfW;
    const tx = cx + dx * lean;
    const tz = cz + dz * lean;
    const tpx = perpx * 0.32; // taper toward the tip
    const tpz = perpz * 0.32;
    // ribbon = 2 triangles (base quad → narrow tip)
    positions.push(
      cx - perpx, 0, cz - perpz, cx + perpx, 0, cz + perpz, tx - tpx, h, tz - tpz,
      cx + perpx, 0, cz + perpz, tx + tpx, h, tz + tpz, tx - tpx, h, tz - tpz,
    );
    for (let k = 0; k < 6; k++) normals.push(0, 1, 0); // up-lit grass
    const shade = 0.82 + rng.float() * 0.4;
    const base = [0.2 * shade, 0.31 * shade, 0.12 * shade] as const;
    const tip = [0.56 * shade, 0.67 * shade, 0.31 * shade] as const;
    colors.push(...base, ...base, ...tip, ...base, ...tip, ...tip);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  g.setAttribute('color', new BufferAttribute(new Float32Array(colors), 3));
  g.setAttribute('normal', new BufferAttribute(new Float32Array(normals), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array((positions.length / 3) * 2), 2));
  return g;
}

/** Leafy bush: alpha-tested photo leaf cards, dark base → lit crown. */
function shrubGeo(rng: Rng, big: boolean): BufferGeometry {
  const scale = big ? rng.range(1.1, 1.7) : rng.range(0.7, 1.05);
  const nCards = rng.int(7, 10);
  const posArr = new Float32Array(nCards * 4 * 3);
  const nrmArr = new Float32Array(nCards * 4 * 3);
  const colArr = new Float32Array(nCards * 4 * 3);
  const uvArr = new Float32Array(nCards * 4 * 2);
  const idx: number[] = [];
  const dir = new Vector3();
  const t1 = new Vector3();
  const t2 = new Vector3();
  const e1 = new Vector3();
  const e2 = new Vector3();
  const ctr = new Vector3();
  const v = new Vector3();
  const yAxis = new Vector3(0, 1, 0);
  const xAxis = new Vector3(1, 0, 0);
  const topY = 1.35 * scale;
  for (let c = 0; c < nCards; c++) {
    const cosT = 2 * rng.float() - 1;
    const sinT = Math.sqrt(Math.max(0, 1 - cosT * cosT));
    const phi = rng.range(0, Math.PI * 2);
    dir.set(sinT * Math.cos(phi), cosT, sinT * Math.sin(phi));
    ctr.copy(dir).multiplyScalar((0.3 + 0.45 * Math.sqrt(rng.float())) * scale);
    ctr.y = ctr.y * 0.65 + 0.62 * scale;
    const ref = Math.abs(dir.y) < 0.94 ? yAxis : xAxis;
    t1.crossVectors(ref, dir).normalize();
    t2.crossVectors(dir, t1);
    const roll = rng.range(0, Math.PI * 2);
    e1.copy(t1).multiplyScalar(Math.cos(roll)).addScaledVector(t2, Math.sin(roll));
    e2.crossVectors(dir, e1);
    e2.addScaledVector(dir, rng.range(-0.35, 0.35)).normalize();
    const half = rng.range(0.4, 0.6) * scale;
    const t = clamp01(ctr.y / topY);
    const mott = 0.82 + rng.float() * 0.36;
    const cr = (0.14 + 0.16 * t) * mott * 2.4;
    const cg = (0.22 + 0.22 * t) * mott * 2.4;
    const cb = (0.09 + 0.09 * t) * mott * 2.4;
    const u0 = rng.chance(0.5) ? 0 : 1;
    const v0 = rng.chance(0.5) ? 0 : 1;
    const base = c * 4;
    for (let k = 0; k < 4; k++) {
      const sx = k === 0 || k === 3 ? -1 : 1;
      const sy = k < 2 ? -1 : 1;
      v.copy(ctr).addScaledVector(e1, sx * half).addScaledVector(e2, sy * half);
      const vi = base + k;
      posArr[vi * 3] = v.x;
      posArr[vi * 3 + 1] = v.y;
      posArr[vi * 3 + 2] = v.z;
      nrmArr[vi * 3] = dir.x;
      nrmArr[vi * 3 + 1] = dir.y;
      nrmArr[vi * 3 + 2] = dir.z;
      colArr[vi * 3] = cr;
      colArr[vi * 3 + 1] = cg;
      colArr[vi * 3 + 2] = cb;
      uvArr[vi * 2] = sx < 0 ? u0 : 1 - u0;
      uvArr[vi * 2 + 1] = sy < 0 ? v0 : 1 - v0;
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(posArr, 3));
  geo.setAttribute('normal', new BufferAttribute(nrmArr, 3));
  geo.setAttribute('color', new BufferAttribute(colArr, 3));
  geo.setAttribute('uv', new BufferAttribute(uvArr, 2));
  geo.setIndex(idx);
  return geo;
}

const FLOWER_COLORS: readonly (readonly [number, number, number])[] = [
  [1.0, 1.0, 0.92], // white daisy
  [1.08, 0.92, 0.3], // yellow buttercup
  [0.96, 0.55, 0.68], // pink
  [0.62, 0.6, 0.98], // blue-violet cornflower
];

/** Wildflower clump: thin stems each topped with a 3-D cup of radiating petals
 * and a small centre disc — real flower heads (not flat crossed quads). */
function flowerClump(rng: Rng, head: readonly [number, number, number]): BufferGeometry {
  const positions: number[] = [];
  const colors: number[] = [];
  const stem = [0.22, 0.32, 0.13] as const;
  const centre = [head[0] * 0.5, head[1] * 0.45, head[2] * 0.28] as const;
  const pushTri = (
    ax: number, ay: number, az: number, bx: number, by: number, bz: number, cxx: number, cy: number, czz: number,
    col: readonly [number, number, number],
  ): void => {
    positions.push(ax, ay, az, bx, by, bz, cxx, cy, czz);
    colors.push(col[0], col[1], col[2], col[0], col[1], col[2], col[0], col[1], col[2]);
  };
  const n = rng.int(2, 4);
  for (let f = 0; f < n; f++) {
    const cx = rng.range(-0.2, 0.2);
    const cz = rng.range(-0.2, 0.2);
    const h = rng.range(0.6, 0.96); // taller than the sward so heads read above it
    const tx = cx + rng.range(-0.07, 0.07);
    const tz = cz + rng.range(-0.07, 0.07);
    const hw = 0.013;
    pushTri(cx - hw, 0, cz, cx + hw, 0, cz, tx + hw, h, tz, stem);
    pushTri(cx - hw, 0, cz, tx + hw, h, tz, tx - hw, h, tz, stem);
    // petal cup: petals radiate out and up from a base ring → 3-D flower head
    const petals = rng.int(5, 8);
    const pr = rng.range(0.08, 0.13);
    const rise = pr * rng.range(0.45, 0.78);
    const a0 = rng.range(0, Math.PI * 2);
    for (let pI = 0; pI < petals; pI++) {
      const a = a0 + (pI / petals) * Math.PI * 2;
      const dx = Math.cos(a);
      const dz = Math.sin(a);
      const bw = pr * 0.4;
      pushTri(
        tx - dz * bw, h, tz + dx * bw,
        tx + dz * bw, h, tz - dx * bw,
        tx + dx * pr, h + rise, tz + dz * pr,
        head,
      );
    }
    // centre disc (small fan), slightly proud and darker
    const cr = pr * 0.34;
    const cy = h + rise * 0.28;
    for (let pI = 0; pI < 5; pI++) {
      const aa = (pI / 5) * Math.PI * 2;
      const ab = ((pI + 1) / 5) * Math.PI * 2;
      pushTri(
        tx, cy, tz,
        tx + Math.cos(aa) * cr, h + 0.005, tz + Math.sin(aa) * cr,
        tx + Math.cos(ab) * cr, h + 0.005, tz + Math.sin(ab) * cr,
        centre,
      );
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  g.setAttribute('color', new BufferAttribute(new Float32Array(colors), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array((positions.length / 3) * 2), 2));
  g.computeVertexNormals();
  return g;
}

/** Tall wheat clump: golden stalks with heads (~30 tris). */
function wheatClump(rng: Rng): BufferGeometry {
  const positions: number[] = [];
  const colors: number[] = [];
  const stalks = 7;
  for (let b = 0; b < stalks; b++) {
    const ang = rng.range(0, Math.PI);
    const dx = Math.cos(ang);
    const dz = Math.sin(ang);
    const h = rng.range(0.55, 0.85);
    const w = rng.range(0.05, 0.08);
    const lean = rng.range(-0.1, 0.1);
    const cx = rng.range(-0.22, 0.22);
    const cz = rng.range(-0.22, 0.22);
    // stalk blade
    positions.push(cx - dx * w, 0, cz - dz * w, cx + dx * w, 0, cz + dz * w, cx + lean, h, cz + lean * 0.5);
    const g0 = rng.range(0.85, 1.1);
    const base = [0.5 * g0, 0.42 * g0, 0.2 * g0] as const;
    const tip = [0.68 * g0, 0.58 * g0, 0.28 * g0] as const;
    colors.push(...base, ...base, ...tip);
    // seed head: small darker diamond at the top
    const hx = cx + lean;
    const hz = cz + lean * 0.5;
    positions.push(hx - 0.035, h - 0.06, hz, hx + 0.035, h - 0.06, hz, hx, h + 0.1, hz);
    const head = [0.58 * g0, 0.47 * g0, 0.22 * g0] as const;
    colors.push(...head, ...head, ...head);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  g.setAttribute('color', new BufferAttribute(new Float32Array(colors), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array((positions.length / 3) * 2), 2));
  g.computeVertexNormals();
  return g;
}

/** Small angular stone (~12 tris). */
function stoneGeo(rng: Rng, tone: number): BufferGeometry {
  const positions: number[] = [];
  const colors: number[] = [];
  const r = 0.5;
  // crude tetra-ish rock from jittered corners
  const pts: [number, number, number][] = [];
  for (let i = 0; i < 5; i++) {
    pts.push([rng.range(-r, r), rng.range(0.05, r * 0.7), rng.range(-r, r)]);
  }
  pts.push([0, 0, 0]);
  const faces: [number, number, number][] = [
    [0, 1, 2], [1, 3, 2], [3, 4, 2], [4, 0, 2], [0, 4, 5], [4, 3, 5], [3, 1, 5], [1, 0, 5],
  ];
  for (const [a, b, c] of faces) {
    const pa = pts[a];
    const pb = pts[b];
    const pc = pts[c];
    if (!pa || !pb || !pc) continue;
    positions.push(...pa, ...pb, ...pc);
    const t = tone * (0.85 + rng.float() * 0.3);
    for (let k = 0; k < 3; k++) colors.push(t, t * 0.97, t * 0.92);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  g.setAttribute('color', new BufferAttribute(new Float32Array(colors), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array((positions.length / 3) * 2), 2));
  g.computeVertexNormals();
  return g;
}

export function buildGroundCover(model: WorldModel, ground: Ground, preset: GraphicsPreset): Group {
  const root = new Group();
  root.name = 'ground-cover';
  const seed = model.seed ^ 0x6c0e5;
  const rng = new Rng(seed);
  const density = preset === 'low' ? 0.45 : preset === 'ultra' ? 1.25 : 1;

  const grassArch = [grassClump(rng.fork('g0')), grassClump(rng.fork('g1')), grassClump(rng.fork('g2'))];
  const stoneArch = [stoneGeo(rng.fork('s0'), 0.5), stoneGeo(rng.fork('s1'), 0.42)];
  const shrubArch = [
    shrubGeo(rng.fork('sh0'), false),
    shrubGeo(rng.fork('sh1'), false),
    shrubGeo(rng.fork('sh2'), true),
  ];
  const flowerArch = FLOWER_COLORS.map((c, i) => flowerClump(rng.fork(`fl${i}`), c));

  const grassMats: Matrix4[][] = grassArch.map(() => []);
  const stoneMats: Matrix4[][] = stoneArch.map(() => []);
  const shrubMats: Matrix4[][] = shrubArch.map(() => []);
  const flowerMats: Matrix4[][] = flowerArch.map(() => []);
  const p = new Vector3();
  const q = new Quaternion();
  const s = new Vector3();
  const up = new Vector3(0, 1, 0);

  const placeGrass = (x: number, z: number, scale: number): void => {
    const arch = Math.floor(hash2D(Math.round(x * 5), Math.round(z * 5), seed) * grassArch.length);
    p.set(x, ground.height(x, z) - 0.02, z);
    q.setFromAxisAngle(up, hash2D(Math.round(x * 7), Math.round(z * 7), seed ^ 1) * 6.28);
    s.setScalar(scale);
    grassMats[arch]?.push(new Matrix4().compose(p, q, s));
  };
  const placeStone = (x: number, z: number, scale: number): void => {
    const arch = Math.floor(hash2D(Math.round(x * 9), Math.round(z * 9), seed ^ 2) * stoneArch.length);
    p.set(x, ground.height(x, z) + 0.01, z);
    q.setFromAxisAngle(up, hash2D(Math.round(x * 3), Math.round(z * 3), seed ^ 3) * 6.28);
    s.setScalar(scale);
    stoneMats[arch]?.push(new Matrix4().compose(p, q, s));
  };
  const placeShrub = (x: number, z: number, scale: number): void => {
    const arch = Math.floor(hash2D(Math.round(x * 4.4), Math.round(z * 4.4), seed ^ 0x5b) * shrubArch.length);
    p.set(x, ground.height(x, z) - 0.12, z);
    q.setFromAxisAngle(up, hash2D(Math.round(x * 2.6), Math.round(z * 2.6), seed ^ 0x5c) * 6.28);
    s.setScalar(scale);
    shrubMats[arch]?.push(new Matrix4().compose(p, q, s));
  };
  const placeFlower = (x: number, z: number, scale: number): void => {
    const arch = Math.floor(hash2D(Math.round(x * 6.1), Math.round(z * 6.1), seed ^ 0xf1) * flowerArch.length);
    p.set(x, ground.height(x, z) - 0.02, z);
    q.setFromAxisAngle(up, hash2D(Math.round(x * 8), Math.round(z * 8), seed ^ 0xf2) * 6.28);
    s.setScalar(scale);
    flowerMats[arch]?.push(new Matrix4().compose(p, q, s));
  };

  // ---- road verges: dense weeds + gravel along every road
  for (const road of model.roads.roads) {
    for (let i = 0; i < road.points.length - 1; i++) {
      const a = road.points[i];
      const b = road.points[i + 1];
      if (!a || !b) continue;
      const segLen = Math.hypot(b.x - a.x, b.z - a.z);
      const steps = Math.max(1, Math.round((segLen / 1.1) * density));
      const nx = -(b.z - a.z) / segLen;
      const nz = (b.x - a.x) / segLen;
      for (let st = 0; st < steps; st++) {
        const t = (st + 0.5) / steps;
        const cx = a.x + (b.x - a.x) * t;
        const cz = a.z + (b.z - a.z) * t;
        for (const side of [-1, 1]) {
          const r1 = hash2D(Math.round(cx * 11 + st), Math.round(cz * 11) + side * 7, seed ^ 4);
          const off = road.width * 0.5 + 0.4 + r1 * 2.4;
          const gx = cx + nx * off * side + (r1 - 0.5) * 1.2;
          const gz = cz + nz * off * side + (r1 - 0.5) * 1.2;
          if (r1 < 0.72) placeGrass(gx, gz, 0.8 + r1 * 0.9);
          else placeStone(gx, gz, 0.1 + r1 * 0.16);
        }
        // gravel spill on the road shoulders
        const r2 = hash2D(Math.round(cx * 13), Math.round(cz * 13), seed ^ 5);
        if (r2 > 0.6) {
          placeStone(cx + nx * (road.width * 0.42) * (r2 > 0.8 ? 1 : -1), cz + nz * (road.width * 0.42) * (r2 > 0.8 ? 1 : -1), 0.07 + r2 * 0.08);
        }
      }
    }
  }

  // ---- dense near-field grass CARPET (LAAS "geometry, not texture"): the
  // ground within camera range is a continuous sward of clumps, gridded with
  // per-cell jitter and distance-attenuated so the foreground reads lush
  // without carpeting the whole 1.6 km map. Roads and crop rows stay clear.
  const carpetR = 235;
  // extend the sward south down the approach corridor the player drives in on
  const corridorZ = 640;
  const corridorHalfW = 90;
  // LAAS-scale density: fps headroom is large (127 fps @ 8 M tris), so pack the
  // near sward tight. spacing is the grid pitch; keep() below sets coverage.
  const spacing = preset === 'low' ? 1.2 : preset === 'ultra' ? 0.38 : 0.5;
  let carpetBudget = preset === 'low' ? 55000 : preset === 'ultra' ? 950000 : 640000;
  for (let gx = -carpetR; gx <= carpetR && carpetBudget > 0; gx += spacing) {
    for (let gz = -carpetR; gz <= corridorZ && carpetBudget > 0; gz += spacing) {
      const jx = gx + (hash2D(Math.round(gx * 13), Math.round(gz * 13), seed ^ 0x77aa) - 0.5) * spacing;
      const jz = gz + (hash2D(Math.round(gx * 17), Math.round(gz * 19), seed ^ 0x88bb) - 0.5) * spacing;
      const d = Math.hypot(jx, jz);
      const inCorridor = jz > 0 && Math.abs(jx) < corridorHalfW;
      if (d > carpetR && !inCorridor) continue;
      if (ground.roadMask(jx, jz) > 0.2) continue;
      const f = ground.fieldAt(jx, jz);
      if (f && (f.crop === 'plow' || f.crop === 'wheat' || f.crop === 'hay')) continue; // crops get stalks
      // gentle clumpy thinning (fbm) + mild distance attenuation. Near field
      // is a near-solid carpet; only the far corridor thins out.
      const nn = fbm2D(jx * 0.06, jz * 0.06, seed ^ 8, 2);
      const keep = (d < 110 ? 1.0 : d < 200 ? 0.9 : 0.6) * (0.72 + nn * 0.5);
      if (hash2D(Math.round(jx * 9), Math.round(jz * 9), seed ^ 0x99cc) > keep) continue;
      placeGrass(jx, jz, 0.85 + nn * 0.8);
      carpetBudget--;
      // wildflowers cluster in meadow patches (low-freq gate); dense within a
      // patch, none between patches → natural drifts of colour across the sward.
      // Verges (near a road) always get some so the drive-in reads flowery.
      if (d < 240) {
        const meadow = fbm2D(jx * 0.024 + 40, jz * 0.024 - 20, seed ^ 0xf10, 2);
        const nearRoad = ground.roadMask(jx, jz) > 0.04;
        const gate = nearRoad ? 0.42 : 0.55;
        if (meadow > 0.48 && hash2D(Math.round(jx * 11), Math.round(jz * 11), seed ^ 0xf0) > gate) {
          placeFlower(jx, jz, 0.85 + nn * 0.5);
        }
      }
    }
  }

  // ---- shrubs / bushes: sparse, clustered in thickets at field edges & verges,
  // a mid-height layer between grass and trees (LAAS-style vegetation stack)
  const nearBuilding = (x: number, z: number): boolean => {
    for (const b of model.buildings) {
      if (Math.hypot(x - b.x, z - b.z) < Math.max(b.halfW, b.halfD) + 1.5) return true;
    }
    return false;
  };
  const shrubN = Math.round(2800 * density);
  for (let i = 0; i < shrubN; i++) {
    const ang = rng.range(0, Math.PI * 2);
    const r = rng.chance(0.7) ? rng.range(24, 235) : rng.range(235, 520);
    let x = Math.cos(ang) * r;
    let z = Math.sin(ang) * r;
    if (rng.chance(0.32)) {
      x = rng.range(-corridorHalfW, corridorHalfW);
      z = rng.range(60, 600);
    }
    if (ground.roadMask(x, z) > 0.25) continue;
    const f = ground.fieldAt(x, z);
    if (f && (f.crop === 'plow' || f.crop === 'wheat' || f.crop === 'hay' || f.crop === 'orchard')) continue;
    const th = fbm2D(x * 0.03 - 15, z * 0.03 + 8, seed ^ 0x5b7, 2);
    if (th < 0.55) continue; // thickets, not uniform
    if (nearBuilding(x, z)) continue;
    placeShrub(x, z, 0.85 + th * 0.7);
  }
  // ---- light far scatter beyond the carpet (235–700 m) so mid-ground isn't bare
  const N = Math.round(6500 * density);
  for (let i = 0; i < N; i++) {
    const ang = rng.range(0, Math.PI * 2);
    const r = rng.range(235, 700);
    const x = Math.cos(ang) * r;
    const z = Math.sin(ang) * r;
    if (ground.roadMask(x, z) > 0.15) continue;
    const f = ground.fieldAt(x, z);
    if (f && (f.crop === 'plow' || f.crop === 'wheat')) continue;
    const n = fbm2D(x * 0.03, z * 0.03, seed ^ 8, 3);
    if (n < 0.35) continue;
    placeGrass(x, z, 0.7 + n * 1.1);
    if (rng.chance(0.07)) placeStone(x + rng.range(-1, 1), z + rng.range(-1, 1), rng.range(0.08, 0.2));
  }

  // ---- wheat/hay fields near the action: real stalk rows on the striping
  const wheatArch = [wheatClump(rng.fork('w0')), wheatClump(rng.fork('w1'))];
  const wheatMats: Matrix4[][] = wheatArch.map(() => []);
  let wheatBudget = Math.round(42000 * density);
  for (const field of model.fields) {
    if (field.crop !== 'wheat' && field.crop !== 'hay') continue;
    const c = polygonCentroid(field.polygon);
    if (Math.hypot(c.x, c.z) > 520) continue; // only fields the cameras visit
    const cos = Math.cos(field.rowDir);
    const sin = Math.sin(field.rowDir);
    const rowGap = 3.2; // matches the terrain's painted row striping
    const alongGap = 1.15;
    for (let v = -160; v <= 160 && wheatBudget > 0; v += rowGap) {
      for (let u = -160; u <= 160 && wheatBudget > 0; u += alongGap) {
        const jx = (hash2D(Math.round(u * 3), Math.round(v * 3), seed ^ 0x33d1) - 0.5) * 0.7;
        const x = c.x + u * cos - (v + jx) * sin;
        const z = c.z + u * sin + (v + jx) * cos;
        if (!pointInPolygon(x, z, field.polygon)) continue;
        if (ground.roadMask(x, z) > 0.1 || ground.craterMask(x, z) > 0.35) continue;
        const arch = (Math.abs(Math.round(u * 7 + v * 13)) % wheatArch.length + wheatArch.length) % wheatArch.length;
        p.set(x, ground.height(x, z) - 0.02, z);
        q.setFromAxisAngle(up, hash2D(Math.round(x * 4), Math.round(z * 4), seed ^ 9) * 6.28);
        const sc = field.crop === 'hay' ? 0.7 : 1;
        s.setScalar(sc * (0.85 + hash2D(Math.round(x * 6), Math.round(z * 6), seed ^ 11) * 0.4));
        wheatMats[arch]?.push(new Matrix4().compose(p, q, s));
        wheatBudget--;
      }
    }
  }
  wheatArch.forEach((geo, i) => {
    const mats = wheatMats[i];
    if (!mats || mats.length === 0) return;
    const im = new InstancedMesh(geo, MAT_GRASS, mats.length);
    mats.forEach((m, k) => im.setMatrixAt(k, m));
    im.instanceMatrix.needsUpdate = true;
    im.castShadow = false;
    im.receiveShadow = true;
    im.frustumCulled = false;
    root.add(im);
  });

  // ---- crater rims: burnt grass + stones
  for (const c of model.craters) {
    const n = Math.round(10 * density);
    for (let i = 0; i < n; i++) {
      const a = rng.range(0, Math.PI * 2);
      const rr = c.radius * rng.range(0.9, 1.5);
      if (rng.chance(0.5)) placeStone(c.x + Math.cos(a) * rr, c.z + Math.sin(a) * rr, rng.range(0.09, 0.22));
      else placeGrass(c.x + Math.cos(a) * rr, c.z + Math.sin(a) * rr, rng.range(0.5, 0.9));
    }
  }

  grassArch.forEach((geo, i) => {
    const mats = grassMats[i];
    if (!mats || mats.length === 0) return;
    const im = new InstancedMesh(geo, MAT_GRASS, mats.length);
    mats.forEach((m, k) => im.setMatrixAt(k, m));
    im.instanceMatrix.needsUpdate = true;
    im.castShadow = false; // tiny geometry: shadows cost > value at this scale
    im.receiveShadow = true;
    im.frustumCulled = false;
    root.add(im);
  });
  stoneArch.forEach((geo, i) => {
    const mats = stoneMats[i];
    if (!mats || mats.length === 0) return;
    const im = new InstancedMesh(geo, MAT_STONE, mats.length);
    mats.forEach((m, k) => im.setMatrixAt(k, m));
    im.instanceMatrix.needsUpdate = true;
    im.castShadow = true;
    im.receiveShadow = true;
    im.frustumCulled = false;
    root.add(im);
  });
  shrubArch.forEach((geo, i) => {
    const mats = shrubMats[i];
    if (!mats || mats.length === 0) return;
    const im = new InstancedMesh(geo, MAT_SHRUB, mats.length);
    mats.forEach((m, k) => im.setMatrixAt(k, m));
    im.instanceMatrix.needsUpdate = true;
    im.castShadow = true;
    im.receiveShadow = true;
    im.frustumCulled = false;
    root.add(im);
  });
  flowerArch.forEach((geo, i) => {
    const mats = flowerMats[i];
    if (!mats || mats.length === 0) return;
    const im = new InstancedMesh(geo, MAT_FLOWER, mats.length);
    mats.forEach((m, k) => im.setMatrixAt(k, m));
    im.instanceMatrix.needsUpdate = true;
    im.castShadow = false;
    im.receiveShadow = true;
    im.frustumCulled = false;
    root.add(im);
  });
  return root;
}
