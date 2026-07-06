/**
 * Procedural infantry: low-poly but recognizable soldiers with helmets
 * (US M1 vs German Stahlhelm), rifles, and three poses (standing/advancing,
 * kneeling, prone). Squads render through InstancedMesh pools — one per
 * (side × pose) — driven by the simulation's per-soldier positions.
 * Also builds the PaK 40 anti-tank gun and MG42 tripod props their crews
 * serve around.
 */

import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Rng } from '../core/Random.ts';

export type SoldierPose = 'stand' | 'kneel' | 'prone';
export type SoldierSide = 'us' | 'de';

const MAT_SOLDIER = new MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0.02 });
const MAT_GUNMETAL = new MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.35 });

// uniforms lightened so backlit soldiers keep their read under the low
// golden-hour ambient fill (they were crushing to near-black cutouts)
const US_UNIFORM = new Color(0.46, 0.43, 0.3);
const US_HELMET = new Color(0.38, 0.4, 0.26);
const DE_UNIFORM = new Color(0.43, 0.46, 0.43);
const DE_HELMET = new Color(0.35, 0.37, 0.35);
const SKIN = new Color(0.64, 0.48, 0.37);
const RIFLE_WOOD = new Color(0.34, 0.24, 0.15);

function paint(g: BufferGeometry, base: Color, rng: Rng, mottle = 0.08): BufferGeometry {
  const pos = g.attributes['position'];
  if (pos) {
    const colors = new Float32Array(pos.count * 3);
    const c = new Color();
    for (let i = 0; i < pos.count; i++) {
      c.copy(base).multiplyScalar(1 + rng.range(-mottle, mottle));
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new BufferAttribute(colors, 3));
  }
  return g.index ? g.toNonIndexed() : g;
}

function bx(w: number, h: number, d: number, x: number, y: number, z: number, c: Color, rng: Rng, rot?: { x?: number; y?: number; z?: number }): BufferGeometry {
  const g = new BoxGeometry(w, h, d);
  if (rot?.z) g.rotateZ(rot.z);
  if (rot?.x) g.rotateX(rot.x);
  if (rot?.y) g.rotateY(rot.y);
  g.translate(x, y, z);
  return paint(g, c, rng);
}

/**
 * Soldier geometry, facing +X, feet at y=0. ~230 tris.
 * Pose changes limb layout and overall height.
 */
export function buildSoldierGeometry(side: SoldierSide, pose: SoldierPose, seed: number): BufferGeometry {
  const rng = new Rng(seed);
  const uniform = side === 'us' ? US_UNIFORM : DE_UNIFORM;
  const helmetC = side === 'us' ? US_HELMET : DE_HELMET;
  const parts: BufferGeometry[] = [];

  const torsoH = 0.62;
  let hipY: number;
  let lean = 0;

  if (pose === 'stand') {
    hipY = 0.82;
    lean = 0.18; // advancing crouch-lean
    // legs mid-stride
    parts.push(bx(0.14, 0.85, 0.15, 0.08, 0.42, 0.09, uniform, rng, { z: -0.16 }));
    parts.push(bx(0.14, 0.85, 0.15, -0.1, 0.42, -0.09, uniform, rng, { z: 0.2 }));
  } else if (pose === 'kneel') {
    hipY = 0.48;
    lean = 0.12;
    parts.push(bx(0.14, 0.5, 0.15, 0.14, 0.26, 0.1, uniform, rng, { z: -0.9 })); // forward shin
    parts.push(bx(0.14, 0.5, 0.15, -0.16, 0.24, -0.1, uniform, rng, { z: 0.5 })); // knee down
  } else {
    hipY = 0.16;
    lean = 1.35; // nearly flat
    parts.push(bx(0.13, 0.7, 0.14, -0.55, 0.1, 0.1, uniform, rng, { z: 1.45 }));
    parts.push(bx(0.13, 0.7, 0.14, -0.6, 0.1, -0.1, uniform, rng, { z: 1.42 }));
  }

  // torso (leaned forward by `lean`)
  const torsoLen = torsoH;
  const tx = Math.sin(lean) * torsoLen * 0.5;
  const ty = hipY + Math.cos(lean) * torsoLen * 0.5;
  parts.push(bx(0.34, torsoLen, 0.42, tx, ty, 0, uniform, rng, { z: -lean }));
  // pack
  parts.push(bx(0.16, 0.3, 0.3, tx - 0.22 * Math.cos(lean), ty + 0.05, 0, new Color().copy(uniform).multiplyScalar(0.85), rng, { z: -lean }));

  // head + helmet
  const headX = Math.sin(lean) * torsoLen + (pose === 'prone' ? 0.16 : 0.02);
  const headY = hipY + Math.cos(lean) * torsoLen + (pose === 'prone' ? 0.12 : 0.16);
  const head = new SphereGeometry(0.11, 12, 9);
  head.translate(headX, headY, 0);
  parts.push(paint(head, SKIN, rng));
  const helmet = new SphereGeometry(0.145, 14, 9);
  helmet.scale(1, side === 'de' ? 0.82 : 0.88, 1);
  helmet.translate(headX, headY + 0.055, 0);
  parts.push(paint(helmet, helmetC, rng));
  if (side === 'de') {
    // stahlhelm flare
    const brim = new CylinderGeometry(0.16, 0.185, 0.06, 10);
    brim.translate(headX, headY + 0.0, 0);
    parts.push(paint(brim, helmetC, rng));
  }

  // arms holding rifle forward
  const armY = ty + torsoLen * 0.18;
  parts.push(bx(0.42, 0.11, 0.12, tx + 0.26, armY, 0.14, uniform, rng, { z: -lean - 0.25 }));
  parts.push(bx(0.4, 0.11, 0.12, tx + 0.22, armY - 0.05, -0.13, uniform, rng, { z: -lean - 0.45 }));

  // rifle: wood + barrel, held across
  const rifleX = tx + 0.45;
  const rifleY = pose === 'prone' ? 0.28 : armY + 0.02;
  parts.push(bx(0.7, 0.05, 0.05, rifleX, rifleY, 0.02, RIFLE_WOOD, rng, { z: pose === 'prone' ? 0 : -0.1 }));
  parts.push(bx(0.36, 0.03, 0.03, rifleX + 0.4, rifleY + (pose === 'prone' ? 0 : -0.04), 0.02, new Color(0.13, 0.13, 0.14), rng, { z: pose === 'prone' ? 0 : -0.1 }));

  const merged = mergeGeometries(parts, false);
  if (!merged) throw new Error('soldier merge failed');
  merged.computeVertexNormals();
  for (const p of parts) p.dispose();
  return merged;
}

// ------------------------------------------------------------------ PaK 40

export interface GunProp {
  group: Group;
  /** Barrel group for traverse/elevation. */
  barrel: Group;
  muzzleLength: number;
}

export function buildPak40(seed: number): GunProp {
  const rng = new Rng(seed);
  const group = new Group();
  const gray = new Color(0.3, 0.32, 0.27);
  const parts: BufferGeometry[] = [];

  // split-trail carriage (spread rearward)
  parts.push(bx(2.2, 0.09, 0.14, -1.0, 0.28, 0.42, gray, rng, { y: 0.28 }));
  parts.push(bx(2.2, 0.09, 0.14, -1.0, 0.28, -0.42, gray, rng, { y: -0.28 }));
  // wheels
  for (const s of [-1, 1]) {
    const wheel = new CylinderGeometry(0.5, 0.5, 0.18, 14);
    wheel.rotateX(Math.PI / 2);
    wheel.translate(0.12, 0.5, s * 0.85);
    parts.push(paint(wheel, new Color(0.16, 0.16, 0.15), rng));
  }
  // double shield plates (angled)
  for (const s of [-1, 1]) {
    parts.push(bx(0.04, 0.85, 0.95, 0.3, 0.85, s * 0.5, gray, rng, { y: s * 0.12, z: -0.12 }));
  }
  const carriage = meshOfParts(parts, MAT_GUNMETAL);
  group.add(carriage);

  // barrel assembly on cradle
  const barrel = new Group();
  barrel.position.set(0.25, 0.92, 0);
  const bparts: BufferGeometry[] = [];
  bparts.push(bx(0.7, 0.24, 0.3, -0.1, 0, 0, gray, rng)); // breech
  bparts.push(paint(new CylinderGeometry(0.05, 0.07, 3.0, 10).rotateZ(Math.PI / 2).translate(1.6, 0.02, 0), gray, rng));
  bparts.push(paint(new CylinderGeometry(0.09, 0.09, 0.32, 8).rotateZ(Math.PI / 2).translate(3.15, 0.02, 0), new Color(0.22, 0.23, 0.2), rng));
  barrel.add(meshOfParts(bparts, MAT_GUNMETAL));
  group.add(barrel);

  return { group, barrel, muzzleLength: 3.3 };
}

export function buildMg42(seed: number): GunProp {
  const rng = new Rng(seed);
  const group = new Group();
  const parts: BufferGeometry[] = [];
  const metal = new Color(0.17, 0.17, 0.18);
  // tripod
  for (const a of [0.6, 2.6, 4.5]) {
    parts.push(bx(0.5, 0.04, 0.04, Math.cos(a) * 0.22, 0.18, Math.sin(a) * 0.22, metal, rng, { y: -a, z: 0.5 }));
  }
  const barrel = new Group();
  barrel.position.set(0, 0.36, 0);
  const bparts: BufferGeometry[] = [];
  bparts.push(bx(0.55, 0.08, 0.06, 0.1, 0, 0, metal, rng));
  bparts.push(paint(new CylinderGeometry(0.025, 0.03, 0.7, 8).rotateZ(Math.PI / 2).translate(0.68, 0.01, 0), metal, rng));
  bparts.push(bx(0.12, 0.16, 0.04, -0.1, -0.05, 0.08, new Color(0.28, 0.22, 0.15), rng)); // ammo box
  barrel.add(meshOfParts(bparts, MAT_GUNMETAL));
  group.add(meshOfParts(parts, MAT_GUNMETAL));
  group.add(barrel);
  return { group, barrel, muzzleLength: 0.9 };
}

/** Sandbag arc emplacement for MG nests / AT positions. */
export function buildSandbagArc(seed: number): Mesh {
  const rng = new Rng(seed);
  const parts: BufferGeometry[] = [];
  const bagC = new Color(0.45, 0.4, 0.3);
  for (let row = 0; row < 2; row++) {
    const n = 7 - row;
    for (let i = 0; i < n; i++) {
      const a = -0.9 + (i / (n - 1)) * 1.8;
      const r = 1.5;
      const g = new BoxGeometry(0.52, 0.2, 0.3);
      g.rotateY(-a + rng.range(-0.1, 0.1));
      g.translate(Math.cos(a) * r, 0.12 + row * 0.19, Math.sin(a) * r);
      parts.push(paint(g, bagC, rng, 0.12));
    }
  }
  const mesh = meshOfParts(parts, MAT_SOLDIER);
  return mesh;
}

function meshOfParts(parts: BufferGeometry[], mat: MeshStandardMaterial): Mesh {
  const merged = mergeGeometries(parts, false);
  if (!merged) throw new Error('gun merge failed');
  merged.computeVertexNormals();
  const m = new Mesh(merged, mat);
  m.castShadow = true;
  m.receiveShadow = true;
  for (const p of parts) p.dispose();
  return m;
}

export { MAT_SOLDIER };
