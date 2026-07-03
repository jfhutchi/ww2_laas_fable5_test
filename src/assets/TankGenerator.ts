/**
 * Procedural WWII armor: Sherman M4A1 (rounded cast hull, 75mm turret,
 * white star), StuG III (low casemate assault gun) and Panzer IV (boxy
 * hull, schürzen side plates). Hull/turret/gun are separate nodes so the
 * simulation can traverse and elevate; wreck variants blacken and slump.
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

export interface VehicleRig {
  group: Group;
  turret: Group;
  gun: Group;
  /** Length of the gun barrel — muzzle offset for flash/projectile spawn. */
  muzzleLength: number;
}

const OLIVE = new Color(0.34, 0.36, 0.22);
const OLIVE_DK = new Color(0.27, 0.29, 0.18);
const GRAY_DE = new Color(0.38, 0.39, 0.37);
const GRAY_DK = new Color(0.3, 0.31, 0.3);
const TRACK = new Color(0.21, 0.2, 0.19);
const RUBBER = new Color(0.16, 0.16, 0.16);
const STAR = new Color(0.85, 0.84, 0.78);

const MAT_BODY = new MeshStandardMaterial({ vertexColors: true, roughness: 0.74, metalness: 0.14 });
const MAT_TRACK = new MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0.08 });

function paint(g: BufferGeometry, base: Color, rng: Rng, mottle = 0.07, jitter = 0): BufferGeometry {
  const pos = g.attributes['position'];
  if (pos) {
    const colors = new Float32Array(pos.count * 3);
    const c = new Color();
    for (let i = 0; i < pos.count; i++) {
      if (jitter > 0) {
        pos.setXYZ(
          i,
          pos.getX(i) + rng.range(-jitter, jitter),
          pos.getY(i) + rng.range(-jitter, jitter),
          pos.getZ(i) + rng.range(-jitter, jitter),
        );
      }
      c.copy(base).multiplyScalar(1 + rng.range(-mottle, mottle));
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new BufferAttribute(colors, 3));
  }
  return g.index ? g.toNonIndexed() : g;
}

function bx(w: number, h: number, d: number, x: number, y: number, z: number, base: Color, rng: Rng, opts: { rotX?: number; rotY?: number; rotZ?: number; mottle?: number; jitter?: number } = {}): BufferGeometry {
  const g = new BoxGeometry(w, h, d);
  if (opts.rotX) g.rotateX(opts.rotX);
  if (opts.rotZ) g.rotateZ(opts.rotZ);
  if (opts.rotY) g.rotateY(opts.rotY);
  g.translate(x, y, z);
  return paint(g, base, rng, opts.mottle ?? 0.07, opts.jitter ?? 0);
}

function cyl(rTop: number, rBot: number, h: number, seg: number, x: number, y: number, z: number, base: Color, rng: Rng, opts: { rotX?: number; rotZ?: number } = {}): BufferGeometry {
  const g = new CylinderGeometry(rTop, rBot, h, seg);
  if (opts.rotX) g.rotateX(opts.rotX);
  if (opts.rotZ) g.rotateZ(opts.rotZ);
  g.translate(x, y, z);
  return paint(g, base, rng);
}

function meshOf(parts: BufferGeometry[], mat: MeshStandardMaterial): Mesh {
  const merged = mergeGeometries(parts, false);
  if (!merged) throw new Error('vehicle merge failed');
  merged.computeVertexNormals();
  const m = new Mesh(merged, mat);
  m.castShadow = true;
  m.receiveShadow = true;
  for (const p of parts) p.dispose();
  return m;
}

/**
 * Track assembly: track loop + road wheels + sprocket/idler, one side.
 * Length along +X (vehicle forward = +X), width dz.
 */
function trackSide(parts: BufferGeometry[], len: number, height: number, width: number, zOff: number, wheels: number, rng: Rng): void {
  // track loop: flattened box ring impression (top run + bottom run + curved ends)
  parts.push(bx(len, height * 0.28, width, 0, height * 0.86, zOff, TRACK, rng, { jitter: 0.008 }));
  parts.push(bx(len, height * 0.3, width, 0, height * 0.15, zOff, TRACK, rng, { jitter: 0.008 }));
  parts.push(cyl(height * 0.42, height * 0.42, width, 10, len / 2, height * 0.5, zOff, TRACK, rng, { rotX: Math.PI / 2 }));
  parts.push(cyl(height * 0.42, height * 0.42, width, 10, -len / 2, height * 0.5, zOff, TRACK, rng, { rotX: Math.PI / 2 }));
  // road wheels
  for (let i = 0; i < wheels; i++) {
    const x = -len / 2 + ((i + 0.5) / wheels) * len;
    parts.push(cyl(height * 0.34, height * 0.34, width * 1.06, 12, x, height * 0.36, zOff, RUBBER, rng, { rotX: Math.PI / 2 }));
  }
}

/** Five-pointed star plate (thin extrusion impression via two star layers). */
function starPlate(parts: BufferGeometry[], size: number, x: number, y: number, z: number, rotY: number, rng: Rng): void {
  const shape: number[] = [];
  const pts = 5;
  for (let i = 0; i < pts * 2; i++) {
    const r = i % 2 === 0 ? size : size * 0.42;
    const a = (i / (pts * 2)) * Math.PI * 2 - Math.PI / 2;
    shape.push(Math.cos(a) * r, Math.sin(a) * r);
  }
  const verts: number[] = [];
  for (let i = 0; i < pts * 2; i++) {
    const j = (i + 1) % (pts * 2);
    verts.push(0, 0, 0, shape[i * 2] ?? 0, shape[i * 2 + 1] ?? 0, 0, shape[j * 2] ?? 0, shape[j * 2 + 1] ?? 0, 0);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(verts), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array((verts.length / 3) * 2), 2));
  g.computeVertexNormals();
  g.rotateY(rotY);
  g.translate(x, y, z);
  parts.push(paint(g, STAR, rng, 0.03));
}

// ----------------------------------------------------------------- Sherman

export function buildSherman(seed: number): VehicleRig {
  const rng = new Rng(seed);
  const group = new Group();
  const hullParts: BufferGeometry[] = [];
  const trackParts: BufferGeometry[] = [];

  // proportions (m): length 5.8, width 2.6, hull height ~1.5, turret on top
  const L = 5.0;
  const W = 2.62;
  const trackW = 0.42;

  trackSide(trackParts, L * 0.94, 0.9, trackW, W / 2 - trackW / 2, 6, rng);
  trackSide(trackParts, L * 0.94, 0.9, trackW, -(W / 2 - trackW / 2), 6, rng);

  const bodyW = W - trackW * 2 - 0.06;
  // lower hull
  hullParts.push(bx(L, 0.55, bodyW, 0, 0.62, 0, OLIVE_DK, rng, { jitter: 0.01 }));
  // upper hull with rounded cast impression: main box + bevel strips + sloped glacis
  hullParts.push(bx(L * 0.82, 0.5, W - 0.1, -L * 0.05, 1.12, 0, OLIVE, rng, { jitter: 0.012 }));
  // sloped glacis (front plate)
  hullParts.push(bx(1.15, 0.52, W - 0.12, L * 0.38, 1.0, 0, OLIVE, rng, { rotZ: -0.62, jitter: 0.01 }));
  // rounded cast shoulders: bevel strips along the upper hull edges
  hullParts.push(bx(L * 0.8, 0.2, 0.34, -L * 0.05, 1.38, bodyW / 2 + 0.06, OLIVE, rng, { rotX: 0.6 }));
  hullParts.push(bx(L * 0.8, 0.2, 0.34, -L * 0.05, 1.38, -(bodyW / 2 + 0.06), OLIVE, rng, { rotX: -0.6 }));
  // engine deck + grills
  hullParts.push(bx(L * 0.3, 0.1, bodyW * 0.9, -L * 0.34, 1.42, 0, OLIVE_DK, rng, {}));
  for (let i = 0; i < 3; i++) {
    hullParts.push(bx(L * 0.26, 0.03, 0.16, -L * 0.34, 1.48, -0.3 + i * 0.3, OLIVE_DK, rng, {}));
  }
  // bow MG ball
  hullParts.push(paint(new SphereGeometry(0.14, 8, 6).translate(L * 0.34, 1.28, -0.5), OLIVE_DK, rng));
  hullParts.push(cyl(0.045, 0.045, 0.5, 6, L * 0.52, 1.28, -0.5, TRACK, rng, { rotZ: Math.PI / 2 }));
  // stowage: boxes and rolled tarp on rear
  hullParts.push(bx(0.5, 0.22, 0.7, -L * 0.42, 1.56, 0.5, new Color(0.32, 0.28, 0.2), rng, { jitter: 0.02 }));
  hullParts.push(cyl(0.12, 0.12, 1.2, 8, -L * 0.46, 1.52, -0.35, new Color(0.35, 0.33, 0.24), rng, { rotX: Math.PI / 2 }));
  // hull star
  starPlate(hullParts, 0.34, 0, 1.13, W / 2 + 0.011, 0, rng);
  starPlate(hullParts, 0.34, 0, 1.13, -(W / 2 + 0.011), Math.PI, rng);

  group.add(meshOf(trackParts, MAT_TRACK));
  group.add(meshOf(hullParts, MAT_BODY));

  // ---- turret (rounded cast: squashed sphere + ring), pivot at hull top
  const turret = new Group();
  turret.position.set(0.25, 1.52, 0);
  const turretParts: BufferGeometry[] = [];
  const dome = new SphereGeometry(0.88, 14, 10);
  dome.scale(1.15, 0.62, 1);
  dome.translate(0, 0.3, 0);
  turretParts.push(paint(dome, OLIVE, rng, 0.06));
  turretParts.push(cyl(0.92, 0.98, 0.24, 14, 0, 0.12, 0, OLIVE_DK, rng, {}));
  // commander cupola + hatch
  turretParts.push(cyl(0.26, 0.28, 0.16, 10, -0.3, 0.78, 0.3, OLIVE_DK, rng, {}));
  turretParts.push(cyl(0.24, 0.24, 0.05, 10, -0.3, 0.88, 0.3, OLIVE, rng, {}));
  // mantlet
  turretParts.push(bx(0.34, 0.5, 0.62, 0.82, 0.3, 0, OLIVE_DK, rng, { jitter: 0.015 }));
  // turret star on top
  starPlate(turretParts, 0.3, -0.1, 0.93, 0, 0, rng);
  {
    const top = turretParts[turretParts.length - 1];
    if (top) top.rotateX(0); // star built in XY; lay flat:
  }
  // (rebuild star flat on top: remove last and add rotated)
  turretParts.pop();
  {
    const flat: BufferGeometry[] = [];
    starPlate(flat, 0.3, 0, 0, 0, 0, rng);
    const s = flat[0];
    if (s) {
      s.rotateX(-Math.PI / 2);
      s.translate(-0.15, 0.865, 0);
      turretParts.push(s);
    }
  }
  turret.add(meshOf(turretParts, MAT_BODY));

  // ---- gun: pivot at mantlet
  const gun = new Group();
  gun.position.set(0.82, 0.3, 0);
  const gunParts: BufferGeometry[] = [];
  gunParts.push(cyl(0.07, 0.09, 2.3, 10, 1.15, 0, 0, OLIVE_DK, rng, { rotZ: Math.PI / 2 }));
  gun.add(meshOf(gunParts, MAT_BODY));
  turret.add(gun);
  group.add(turret);

  return { group, turret, gun, muzzleLength: 2.3 };
}

// ------------------------------------------------------------------- StuG

export function buildStuG(seed: number): VehicleRig {
  const rng = new Rng(seed);
  const group = new Group();
  const hullParts: BufferGeometry[] = [];
  const trackParts: BufferGeometry[] = [];

  const L = 5.3;
  const W = 2.9;
  const trackW = 0.44;
  trackSide(trackParts, L * 0.95, 0.82, trackW, W / 2 - trackW / 2, 6, rng);
  trackSide(trackParts, L * 0.95, 0.82, trackW, -(W / 2 - trackW / 2), 6, rng);

  const bodyW = W - trackW * 2 - 0.06;
  hullParts.push(bx(L, 0.5, bodyW, 0, 0.58, 0, GRAY_DK, rng, { jitter: 0.01 }));
  // low casemate superstructure with sloped sides
  hullParts.push(bx(L * 0.62, 0.52, bodyW * 0.98, 0.2, 1.06, 0, GRAY_DE, rng, { jitter: 0.012 }));
  hullParts.push(bx(0.9, 0.5, bodyW * 0.96, L * 0.4, 0.9, 0, GRAY_DE, rng, { rotZ: -0.55 }));
  hullParts.push(bx(L * 0.6, 0.34, 0.4, 0.2, 1.3, bodyW * 0.42, GRAY_DE, rng, { rotX: 0.5 }));
  hullParts.push(bx(L * 0.6, 0.34, 0.4, 0.2, 1.3, -bodyW * 0.42, GRAY_DE, rng, { rotX: -0.5 }));
  // commander's hatch + shield
  hullParts.push(bx(0.5, 0.08, 0.5, -0.4, 1.36, 0.45, GRAY_DK, rng, {}));
  // exhausts at rear
  hullParts.push(cyl(0.09, 0.09, 0.7, 8, -L * 0.46, 0.85, 0.5, TRACK, rng, { rotX: Math.PI / 2 }));
  // spare road wheels on rear deck
  hullParts.push(cyl(0.28, 0.28, 0.1, 10, -L * 0.34, 1.2, -0.5, GRAY_DK, rng, {}));

  group.add(meshOf(trackParts, MAT_TRACK));
  group.add(meshOf(hullParts, MAT_BODY));

  // fixed gun in casemate front (turret group exists but is locked by sim)
  const turret = new Group();
  turret.position.set(0.9, 1.05, 0.1);
  const gun = new Group();
  const gunParts: BufferGeometry[] = [];
  gunParts.push(bx(0.4, 0.34, 0.44, 0.1, 0, 0, GRAY_DK, rng, { jitter: 0.01 })); // mantlet block
  gunParts.push(cyl(0.06, 0.08, 2.6, 10, 1.4, 0, 0, GRAY_DE, rng, { rotZ: Math.PI / 2 }));
  gunParts.push(cyl(0.1, 0.1, 0.3, 8, 2.65, 0, 0, GRAY_DK, rng, { rotZ: Math.PI / 2 })); // muzzle brake
  gun.add(meshOf(gunParts, MAT_BODY));
  turret.add(gun);
  group.add(turret);

  return { group, turret, gun, muzzleLength: 2.8 };
}

// --------------------------------------------------------------- Panzer IV

export function buildPanzer4(seed: number): VehicleRig {
  const rng = new Rng(seed);
  const group = new Group();
  const hullParts: BufferGeometry[] = [];
  const trackParts: BufferGeometry[] = [];

  const L = 5.4;
  const W = 2.9;
  const trackW = 0.42;
  trackSide(trackParts, L * 0.96, 0.86, trackW, W / 2 - trackW / 2, 8, rng);
  trackSide(trackParts, L * 0.96, 0.86, trackW, -(W / 2 - trackW / 2), 8, rng);

  const bodyW = W - trackW * 2 - 0.06;
  hullParts.push(bx(L, 0.52, bodyW, 0, 0.6, 0, GRAY_DK, rng, { jitter: 0.01 }));
  hullParts.push(bx(L * 0.7, 0.5, bodyW, 0.1, 1.1, 0, GRAY_DE, rng, { jitter: 0.012 }));
  hullParts.push(bx(1.0, 0.5, bodyW, L * 0.4, 1.02, 0, GRAY_DE, rng, { rotZ: -0.25 }));
  // schürzen side skirts (thin plates hanging beside the tracks)
  hullParts.push(bx(L * 0.86, 0.6, 0.03, 0, 1.05, W / 2 + 0.1, GRAY_DE, rng, { jitter: 0.02, mottle: 0.12 }));
  hullParts.push(bx(L * 0.86, 0.6, 0.03, 0, 1.05, -(W / 2 + 0.1), GRAY_DE, rng, { jitter: 0.02, mottle: 0.12 }));

  group.add(meshOf(trackParts, MAT_TRACK));
  group.add(meshOf(hullParts, MAT_BODY));

  // boxy turret with cupola
  const turret = new Group();
  turret.position.set(0.15, 1.42, 0);
  const tParts: BufferGeometry[] = [];
  tParts.push(bx(1.7, 0.55, 1.9, 0, 0.28, 0, GRAY_DE, rng, { jitter: 0.012 }));
  tParts.push(bx(1.3, 0.16, 1.5, 0, 0.62, 0, GRAY_DK, rng, {}));
  tParts.push(cyl(0.3, 0.32, 0.28, 10, -0.55, 0.68, 0, GRAY_DK, rng, {}));
  tParts.push(bx(0.36, 0.42, 0.7, 0.85, 0.24, 0, GRAY_DK, rng, {})); // mantlet
  turret.add(meshOf(tParts, MAT_BODY));

  const gun = new Group();
  gun.position.set(0.85, 0.24, 0);
  const gParts: BufferGeometry[] = [];
  gParts.push(cyl(0.055, 0.075, 2.9, 10, 1.45, 0, 0, GRAY_DE, rng, { rotZ: Math.PI / 2 }));
  gParts.push(cyl(0.095, 0.095, 0.26, 8, 2.92, 0, 0, GRAY_DK, rng, { rotZ: Math.PI / 2 }));
  gun.add(meshOf(gParts, MAT_BODY));
  turret.add(gun);
  group.add(turret);

  return { group, turret, gun, muzzleLength: 3.1 };
}

/** Charred wreck tint applied to a cloned rig (Phase 3 adds fire/smoke FX). */
export function applyWreckLook(rig: VehicleRig): void {
  const char = new Color(0.09, 0.085, 0.08);
  for (const root of [rig.group]) {
    root.traverse((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh) return;
      const geo = mesh.geometry;
      const col = geo.getAttribute('color');
      if (col) {
        for (let i = 0; i < col.count; i++) {
          // keep a little of the original tone so panel lines survive the burn
          col.setXYZ(i, char.r + col.getX(i) * 0.1, char.g + col.getY(i) * 0.1, char.b + col.getZ(i) * 0.1);
        }
        col.needsUpdate = true;
      }
    });
  }
  // slump: turret askew
  rig.turret.rotation.y = 0.5;
  rig.turret.position.y -= 0.12;
  rig.gun.rotation.z = -0.06;
}
