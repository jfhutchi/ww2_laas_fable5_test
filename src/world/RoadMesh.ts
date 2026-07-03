/**
 * Road surface strips draped over the terrain: cambered cross-section,
 * strong cobble/dirt/damaged coloring with wheel ruts, verge feathering into
 * grass, pothole scorch on the damaged approach, and cobble-band striping
 * near the village so paved roads read at tactical zoom.
 */

import { BufferAttribute, BufferGeometry, Group, Mesh, MeshStandardMaterial } from 'three';
import { fbm2D } from '../core/Noise.ts';
import { hash2D } from '../core/Random.ts';
import { lerp, smoothstep } from '../core/MathUtil.ts';
import type { WorldModel } from './WorldTypes.ts';
import type { Ground } from './Ground.ts';

const MAT_ROAD = new MeshStandardMaterial({ vertexColors: true, roughness: 0.97, metalness: 0 });
MAT_ROAD.name = 'roads';

// cross-section sample offsets as fractions of half-width (+ verge apron)
const PROFILE = [-1.45, -1.0, -0.55, 0, 0.55, 1.0, 1.45] as const;

export function buildRoads(model: WorldModel, ground: Ground): Group {
  const root = new Group();
  root.name = 'roads';
  const seed = model.seed ^ 0x40ad;

  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];

  for (const road of model.roads.roads) {
    const half = road.width / 2;
    // resample the polyline at ~3 m
    const pts: { x: number; z: number }[] = [];
    for (let i = 0; i < road.points.length - 1; i++) {
      const a = road.points[i];
      const b = road.points[i + 1];
      if (!a || !b) continue;
      const segLen = Math.hypot(b.x - a.x, b.z - a.z);
      const steps = Math.max(1, Math.round(segLen / 3));
      for (let s = 0; s < steps; s++) {
        const t = s / steps;
        pts.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
      }
    }
    const last = road.points[road.points.length - 1];
    if (last) pts.push({ x: last.x, z: last.z });
    if (pts.length < 2) continue;

    const rowStart = positions.length / 3;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const q = pts[Math.min(i + 1, pts.length - 1)];
      const pr = pts[Math.max(i - 1, 0)];
      if (!p || !q || !pr) continue;
      const dirX = q.x - pr.x;
      const dirZ = q.z - pr.z;
      const dl = Math.hypot(dirX, dirZ) || 1;
      const nx = -dirZ / dl;
      const nz = dirX / dl;
      const along = i * 3;

      for (let k = 0; k < PROFILE.length; k++) {
        const f = PROFILE[k] ?? 0;
        const off = f * half;
        const x = p.x + nx * off;
        const z = p.z + nz * off;
        const isVerge = Math.abs(f) > 1.2;
        // camber: crown at centre, verge drops to terrain
        const crown = (1 - Math.min(1, Math.abs(f))) * 0.07;
        const lift = isVerge ? 0.015 : 0.05;
        positions.push(x, ground.height(x, z) + lift + crown, z);

        // ---- color
        let r: number;
        let g: number;
        let b: number;
        const wear = fbm2D(x * 0.11, z * 0.11, seed, 3);
        const macro = fbm2D(x * 0.013, z * 0.013, seed ^ 0x33, 3);
        if (road.kind === 'paved') {
          // cobbles: light warm stone with banding so it reads at altitude
          const band = hash2D(Math.round(along / 1.1), Math.round(off * 2), seed) * 0.14;
          r = 0.5 + band + wear * 0.08;
          g = 0.465 + band + wear * 0.075;
          b = 0.42 + band + wear * 0.06;
        } else if (road.kind === 'damaged') {
          // shell-pocked gray, muddier than paved
          r = 0.4 + wear * 0.1;
          g = 0.365 + wear * 0.09;
          b = 0.32 + wear * 0.07;
        } else {
          // dirt: strong warm tan cart track
          r = 0.55 + wear * 0.12 + macro * 0.05;
          g = 0.44 + wear * 0.1 + macro * 0.04;
          b = 0.285 + wear * 0.07 + macro * 0.03;
        }
        // wheel ruts at ±0.55 halves
        if (Math.abs(Math.abs(f) - 0.55) < 0.2) {
          r *= 0.68;
          g *= 0.68;
          b *= 0.7;
        }
        // mud/pothole darkening from craters (damaged approach)
        const cm = ground.craterMask(x, z);
        if (cm > 0.02) {
          r = lerp(r, 0.16, cm * 0.8);
          g = lerp(g, 0.135, cm * 0.8);
          b = lerp(b, 0.11, cm * 0.8);
        }
        // verge feathers into grass tones
        if (isVerge) {
          const vt = smoothstep(1.2, 1.45, Math.abs(f));
          r = lerp(r, 0.34 * (0.85 + macro * 0.3), vt);
          g = lerp(g, 0.4 * (0.85 + macro * 0.3), vt);
          b = lerp(b, 0.22 * (0.85 + macro * 0.3), vt);
        }
        colors.push(r, g, b);
      }
    }

    const cols = PROFILE.length;
    for (let i = 0; i < pts.length - 1; i++) {
      for (let k = 0; k < cols - 1; k++) {
        const a = rowStart + i * cols + k;
        const b = a + 1;
        const c = a + cols;
        const d = c + 1;
        // rows advance along the road, columns along the left-to-right
        // normal — this winding keeps face normals pointing up
        indices.push(a, b, c, b, d, c);
      }
    }
  }

  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  geo.setAttribute('color', new BufferAttribute(new Float32Array(colors), 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  const mesh = new Mesh(geo, MAT_ROAD);
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  root.add(mesh);
  return root;
}
