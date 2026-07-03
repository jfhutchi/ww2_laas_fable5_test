/**
 * Near-field ground cover: instanced grass clumps, roadside weeds, gravel
 * stones and small debris so the ground within camera range is geometry,
 * not bare texture (LAAS Pillar A). Density concentrates where cameras
 * live: road verges, the village bowl, and the southern approach.
 */

import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  Group,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
} from 'three';
import { Rng, hash2D } from '../core/Random.ts';
import { fbm2D } from '../core/Noise.ts';
import type { Ground } from '../world/Ground.ts';
import type { WorldModel } from '../world/WorldTypes.ts';
import type { GraphicsPreset } from '../app/Config.ts';

const MAT_GRASS = new MeshStandardMaterial({ vertexColors: true, roughness: 0.95, side: DoubleSide });
const MAT_STONE = new MeshStandardMaterial({ vertexColors: true, roughness: 0.98 });

/** Cross-quad grass clump with bent blades (~26 tris). */
function grassClump(rng: Rng): BufferGeometry {
  const positions: number[] = [];
  const colors: number[] = [];
  const blades = 8;
  for (let b = 0; b < blades; b++) {
    const ang = (b / blades) * Math.PI + rng.range(-0.2, 0.2);
    const dx = Math.cos(ang);
    const dz = Math.sin(ang);
    const h = rng.range(0.22, 0.5);
    const w = rng.range(0.10, 0.16);
    const lean = rng.range(-0.12, 0.12);
    const cx = rng.range(-0.14, 0.14);
    const cz = rng.range(-0.14, 0.14);
    // two triangles forming a tapering blade
    const x0 = cx - dx * w;
    const z0 = cz - dz * w;
    const x1 = cx + dx * w;
    const z1 = cz + dz * w;
    const xt = cx + lean;
    const zt = cz + lean * 0.6;
    positions.push(x0, 0, z0, x1, 0, z1, xt, h, zt);
    const g0 = 0.32 + rng.float() * 0.2;
    const base = [0.24 * g0 * 2.4, 0.3 * g0 * 2.6, 0.12 * g0 * 2.2] as const;
    const tip = [base[0] * 1.5, base[1] * 1.45, base[2] * 1.3] as const;
    colors.push(...base, ...base, ...tip);
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

  const grassMats: Matrix4[][] = grassArch.map(() => []);
  const stoneMats: Matrix4[][] = stoneArch.map(() => []);
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

  // ---- village bowl + approach: scattered clumps over open grass
  const N = Math.round(15000 * density);
  for (let i = 0; i < N; i++) {
    const ang = rng.range(0, Math.PI * 2);
    // bias toward the village and the south approach
    const r = rng.chance(0.6) ? rng.range(15, 330) : rng.range(330, 700);
    let x = Math.cos(ang) * r;
    let z = Math.sin(ang) * r;
    if (rng.chance(0.3)) {
      // extra weight along the south road corridor
      x = rng.range(-60, 60);
      z = rng.range(80, 620);
    }
    if (ground.roadMask(x, z) > 0.15) continue;
    const f = ground.fieldAt(x, z);
    if (f && (f.crop === 'plow' || f.crop === 'wheat')) continue; // crop rows read better clean
    const n = fbm2D(x * 0.03, z * 0.03, seed ^ 8, 3);
    if (n < 0.35) continue; // clumpy distribution, not uniform
    placeGrass(x, z, 0.7 + n * 1.1);
    if (rng.chance(0.07)) placeStone(x + rng.range(-1, 1), z + rng.range(-1, 1), rng.range(0.08, 0.2));
  }

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
  return root;
}
