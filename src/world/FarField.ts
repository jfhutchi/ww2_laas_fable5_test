/**
 * Far-field horizon composition beyond the playable 800 m: a vertex-colored
 * patchwork annulus out to FAR_RADIUS, instanced woodland blobs, and two
 * distant village silhouettes. Everything out here is matte and shadowless
 * (it sits far outside the shadow frustum) — scene fog supplies the aerial
 * perspective. Deterministic from model.seed (+ preset detail tiers).
 */

import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  ConeGeometry,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
} from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import type { GraphicsPreset } from '../app/Config.ts';
import type { WorldModel } from './WorldTypes.ts';
import type { Ground } from './Ground.ts';
import { FAR_RADIUS } from './WorldConst.ts';
import { Rng, hash2D } from '../core/Random.ts';
import { fbm2D, warped2D } from '../core/Noise.ts';
import { clamp, clamp01, lerp, smoothstep } from '../core/MathUtil.ts';

/** Ring starts inside PLAY_HALF so the seam hides under the playable terrain. */
const INNER_RADIUS = 780;
/** Sink below baseHeight to avoid z-fighting where the meshes overlap. */
const SINK = 0.5;

/** One matte vertex-colored material shared by every far-field draw. */
const FAR_MAT = new MeshStandardMaterial({ vertexColors: true, roughness: 1.0, metalness: 0.0 });

interface Tone {
  r: number;
  g: number;
  b: number;
}

interface VillageCenter {
  x: number;
  z: number;
}

// Muted Normandy field patchwork tones (already slightly desaturated).
const FIELD_TONES: readonly Tone[] = [
  { r: 0.7, g: 0.6, b: 0.36 }, // wheat gold
  { r: 0.42, g: 0.5, b: 0.27 }, // pasture green
  { r: 0.46, g: 0.37, b: 0.26 }, // plough brown
  { r: 0.68, g: 0.63, b: 0.42 }, // hay pale
  { r: 0.36, g: 0.45, b: 0.25 }, // dark pasture
  { r: 0.58, g: 0.55, b: 0.33 }, // dry meadow
];
const FALLBACK_TONE: Tone = { r: 0.5, g: 0.5, b: 0.35 };
const HEDGE_TONE: Tone = { r: 0.24, g: 0.3, b: 0.16 };

// ---------------------------------------------------------------- annulus

function buildRing(model: WorldModel, ground: Ground, preset: GraphicsPreset): Mesh {
  const radSegs = preset === 'low' ? 30 : preset === 'high' ? 48 : 56;
  const angSegs = preset === 'low' ? 108 : preset === 'high' ? 160 : 192;
  const vertCount = (radSegs + 1) * angSegs;
  const positions = new Float32Array(vertCount * 3);
  const colors = new Float32Array(vertCount * 3);

  const sBand = (model.seed ^ 0x0fa11d) >>> 0;
  const sTone = (model.seed ^ 0x33aa77) >>> 0;
  const sVar = (model.seed ^ 0x71c355) >>> 0;

  let vi = 0;
  for (let i = 0; i <= radSegs; i++) {
    // exponential radial spacing: detail near the seam, long strips far out
    const t = i / radSegs;
    const radius = INNER_RADIUS * Math.pow(FAR_RADIUS / INNER_RADIUS, t);
    for (let j = 0; j < angSegs; j++) {
      const a = (j / angSegs) * Math.PI * 2;
      const x = Math.cos(a) * radius;
      const z = Math.sin(a) * radius;
      positions[vi * 3] = x;
      positions[vi * 3 + 1] = ground.baseHeight(x, z) - SINK;
      positions[vi * 3 + 2] = z;

      // quantized warped noise -> organic field patches with hedgerow seams
      const band = warped2D(x * 0.0016, z * 0.0016, sBand, 1.35, 4) * 10;
      const bi = Math.floor(band);
      const f = band - bi;
      const tone = FIELD_TONES[Math.floor(hash2D(bi, 41, sTone) * FIELD_TONES.length)] ?? FALLBACK_TONE;
      const shade = 0.9 + fbm2D(x * 0.02, z * 0.02, sVar, 2) * 0.2;
      let r = tone.r * shade;
      let g = tone.g * shade;
      let b = tone.b * shade;

      // dark hedgerow line where the band value crosses a threshold
      const edge = smoothstep(0.42, 0.492, Math.abs(f - 0.5));
      r = lerp(r, HEDGE_TONE.r, edge);
      g = lerp(g, HEDGE_TONE.g, edge);
      b = lerp(b, HEDGE_TONE.b, edge);

      // gentle desaturation with distance (fog finishes the job)
      const dd = smoothstep(1500, FAR_RADIUS, radius) * 0.22;
      colors[vi * 3] = clamp01(lerp(r, 0.55, dd));
      colors[vi * 3 + 1] = clamp01(lerp(g, 0.53, dd));
      colors[vi * 3 + 2] = clamp01(lerp(b, 0.46, dd));
      vi++;
    }
  }

  const indices = new Uint32Array(radSegs * angSegs * 6);
  let ii = 0;
  for (let i = 0; i < radSegs; i++) {
    for (let j = 0; j < angSegs; j++) {
      const j2 = (j + 1) % angSegs;
      const v00 = i * angSegs + j;
      const v01 = i * angSegs + j2;
      const v10 = (i + 1) * angSegs + j;
      const v11 = (i + 1) * angSegs + j2;
      indices[ii++] = v00;
      indices[ii++] = v01;
      indices[ii++] = v10;
      indices[ii++] = v01;
      indices[ii++] = v11;
      indices[ii++] = v10;
    }
  }

  const geo = new BufferGeometry();
  geo.setIndex(new BufferAttribute(indices, 1));
  geo.setAttribute('position', new BufferAttribute(positions, 3));
  geo.setAttribute('color', new BufferAttribute(colors, 3));
  geo.computeVertexNormals();

  const mesh = new Mesh(geo, FAR_MAT);
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.name = 'far-ring';
  return mesh;
}

// ------------------------------------------------------------------ woods

/** Displaced squashed icosphere canopy blob with baked shading colors. */
function makeCanopyGeometry(seed: number, detail: number, squash: number): BufferGeometry {
  const base = new IcosahedronGeometry(1, detail);
  base.deleteAttribute('uv');
  base.deleteAttribute('normal');
  const geo = mergeVertices(base);
  base.dispose();

  const pos = geo.getAttribute('position');
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const px = pos.getX(i);
    const py = pos.getY(i);
    const pz = pos.getZ(i);
    const inv = 1 / (Math.hypot(px, py, pz) || 1);
    const nx = px * inv;
    const ny = py * inv;
    const nz = pz * inv;

    // lumpy canopy silhouette
    const bump = fbm2D(nx * 1.8 + nz * 0.9 + 7.3, ny * 1.8 - nz * 0.7, seed, 4);
    const radius = 0.72 + (bump - 0.5) * 0.66;
    const x = nx * radius;
    let y = ny * radius * squash;
    const z = nz * radius;
    if (y < -0.1) y = -0.1 + (y + 0.1) * 0.15; // near-flat base that sits into the ground
    pos.setXYZ(i, x, y, z);

    // dark green, self-shadowed underside, mottled crown
    const hT = clamp01((y + 0.12) / (squash * 0.9));
    const mottle = 0.78 + fbm2D(nx * 3.3 + 11.7, (ny + nz) * 3.3, (seed ^ 0x2b) >>> 0, 3) * 0.5;
    const k = (0.52 + 0.58 * hT) * mottle;
    colors[i * 3] = clamp01(0.215 * k);
    colors[i * 3 + 1] = clamp01(0.27 * k);
    colors[i * 3 + 2] = clamp01(0.145 * k);
  }
  geo.computeVertexNormals();
  geo.setAttribute('color', new BufferAttribute(colors, 3));
  return geo;
}

function buildWoods(
  model: WorldModel,
  ground: Ground,
  preset: GraphicsPreset,
  avoid: readonly VillageCenter[],
): InstancedMesh[] {
  const detail = preset === 'low' ? 1 : preset === 'high' ? 2 : 3;
  const total = preset === 'low' ? 60 : preset === 'high' ? 96 : 120;
  const rng = new Rng((model.seed ^ 0x77aa13) >>> 0);

  const archetypes = [
    makeCanopyGeometry((model.seed ^ 0x00d1ce) >>> 0, detail, 0.5),
    makeCanopyGeometry((model.seed ^ 0x00f00d) >>> 0, detail, 0.38),
  ];
  const half = Math.floor(total / 2);
  const counts = [total - half, half];

  const mat4 = new Matrix4();
  const posV = new Vector3();
  const quat = new Quaternion();
  const sclV = new Vector3();
  const axisY = new Vector3(0, 1, 0);
  const tint = new Color();
  const meshes: InstancedMesh[] = [];

  for (let k = 0; k < archetypes.length; k++) {
    const geoK = archetypes[k];
    const countK = counts[k];
    if (!geoK || countK === undefined) continue;

    const im = new InstancedMesh(geoK, FAR_MAT, countK);
    im.castShadow = false;
    im.receiveShadow = false;

    for (let i = 0; i < countK; i++) {
      let x = 0;
      let z = 0;
      // rejection-sample away from village silhouettes (bounded, deterministic)
      for (let attempt = 0; attempt < 8; attempt++) {
        const az = rng.range(0, Math.PI * 2);
        const radius = 880 + (FAR_RADIUS - 250 - 880) * Math.pow(rng.float(), 1.3);
        x = Math.cos(az) * radius;
        z = Math.sin(az) * radius;
        let ok = true;
        for (const c of avoid) {
          const dx = x - c.x;
          const dz = z - c.z;
          if (dx * dx + dz * dz < 170 * 170) {
            ok = false;
            break;
          }
        }
        if (ok) break;
      }

      const sx = rng.range(16, 47); // blob width 30..90 m
      const sy = sx * rng.range(0.85, 1.15);
      const sz = sx * rng.range(0.78, 1.28);
      posV.set(x, ground.baseHeight(x, z) - SINK, z);
      quat.setFromAxisAngle(axisY, rng.range(0, Math.PI * 2));
      sclV.set(sx, sy, sz);
      mat4.compose(posV, quat, sclV);
      im.setMatrixAt(i, mat4);
      // per-instance hue/value jitter so no two woods read as clones
      tint.setRGB(rng.range(0.8, 1.2), rng.range(0.85, 1.18), rng.range(0.8, 1.2));
      im.setColorAt(i, tint);
    }
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    im.computeBoundingSphere();
    im.name = `far-woods-${k}`;
    meshes.push(im);
  }
  return meshes;
}

// --------------------------------------------------------------- villages

/** Constant color with tiny per-vertex jitter, for merged silhouette boxes. */
function paintFlat(geo: BufferGeometry, r: number, g: number, b: number, seed: number): void {
  const pos = geo.getAttribute('position');
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const jitter = 0.93 + hash2D(i, 9, seed) * 0.14;
    colors[i * 3] = clamp01(r * jitter);
    colors[i * 3 + 1] = clamp01(g * jitter);
    colors[i * 3 + 2] = clamp01(b * jitter);
  }
  geo.setAttribute('color', new BufferAttribute(colors, 3));
}

function buildVillages(model: WorldModel, ground: Ground): { mesh: Mesh; centers: VillageCenter[] } {
  const rng = new Rng((model.seed ^ 0x5111a7) >>> 0);
  const parts: BufferGeometry[] = [];
  const centers: VillageCenter[] = [];

  const az0 = rng.range(0, Math.PI * 2);
  const azimuths = [az0, az0 + rng.range(1.6, 2.9)];
  for (let v = 0; v < azimuths.length; v++) {
    const az = azimuths[v];
    if (az === undefined) continue;
    const dist = rng.range(1600, 2600);
    const cx = Math.cos(az) * dist;
    const cz = Math.sin(az) * dist;
    centers.push({ x: cx, z: cz });

    const street = rng.range(0, Math.PI * 2);
    const cosS = Math.cos(street);
    const sinS = Math.sin(street);

    const houseCount = rng.int(6, 10);
    for (let h = 0; h < houseCount; h++) {
      // scattered along a loose street axis
      const u = clamp(rng.gaussian(0, 42), -105, 105);
      const w = clamp(rng.gaussian(0, 20), -55, 55);
      const x = cx + cosS * u - sinS * w;
      const z = cz + sinS * u + cosS * w;
      const bw = rng.range(7, 13);
      const bd = rng.range(8, 16);
      const bh = rng.range(4, 7.5);
      const rot = street + (rng.chance(0.5) ? 0 : Math.PI / 2) + rng.range(-0.16, 0.16);
      const gy = ground.baseHeight(x, z) - SINK - 0.9;

      const body = new BoxGeometry(bw, bh, bd);
      body.rotateY(-rot);
      body.translate(x, gy + bh * 0.5, z);
      const jw = rng.range(-0.03, 0.03);
      paintFlat(body, 0.42 + jw, 0.385 + jw, 0.345 + jw * 0.7, (model.seed ^ (v * 131 + h * 17)) >>> 0);
      parts.push(body);

      const rh = bh * rng.range(0.32, 0.45);
      const roof = new BoxGeometry(bw + 0.7, rh, bd + 0.7);
      roof.rotateY(-rot);
      roof.translate(x, gy + bh + rh * 0.5 - 0.05, z);
      paintFlat(roof, 0.3, 0.272, 0.245, (model.seed ^ (v * 131 + h * 17 + 7)) >>> 0);
      parts.push(roof);
    }

    // church: square tower + pyramid spire, the tallest thing on the skyline
    const sx = cx + rng.range(-25, 25);
    const sz = cz + rng.range(-25, 25);
    const gy = ground.baseHeight(sx, sz) - SINK - 0.9;
    const towerH = rng.range(11, 15);
    const tower = new BoxGeometry(4.6, towerH, 4.6);
    tower.rotateY(-street);
    tower.translate(sx, gy + towerH * 0.5, sz);
    paintFlat(tower, 0.375, 0.35, 0.315, (model.seed ^ (v + 0x51e)) >>> 0);
    parts.push(tower);

    const spireH = rng.range(7, 10);
    const spire = new ConeGeometry(3.4, spireH, 4, 1);
    spire.rotateY(Math.PI / 4 - street); // align pyramid faces with the tower
    spire.translate(sx, gy + towerH + spireH * 0.5 - 0.1, sz);
    paintFlat(spire, 0.26, 0.24, 0.225, (model.seed ^ (v + 0xa5e)) >>> 0);
    parts.push(spire);
  }

  const merged = mergeGeometries(parts, false) ?? new BufferGeometry();
  for (const p of parts) p.dispose();
  const mesh = new Mesh(merged, FAR_MAT);
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.name = 'far-villages';
  return { mesh, centers };
}

// ------------------------------------------------------------------- entry

export function buildFarField(model: WorldModel, ground: Ground, preset: GraphicsPreset): Group {
  const group = new Group();
  group.name = 'far-field';
  group.add(buildRing(model, ground, preset));
  const villages = buildVillages(model, ground);
  for (const woods of buildWoods(model, ground, preset, villages.centers)) group.add(woods);
  group.add(villages.mesh);
  return group;
}
