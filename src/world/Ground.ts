/**
 * Ground: continuous terrain height + surface classification derived from
 * the WorldModel. Terrain meshes, cameras, unit movement, projectile impact
 * and material splats all sample this one object, so visuals and simulation
 * can never disagree about the ground.
 *
 * Heights combine: gentle Normandy relief (fBm), village flattening, road
 * smoothing (terrain pulled to a low-passed road profile near roads), and
 * shell crater bowls. A rasterized road index keeps queries O(1).
 */

import { fbm2D } from '../core/Noise.ts';
import { PLAY_HALF, VILLAGE_RADIUS } from './WorldConst.ts';
import type { CraterSpec, FieldSpec, GroundSampler, RoadKind, WorldModel } from './WorldTypes.ts';
import { pointInPolygon } from './WorldTypes.ts';
import { clamp01, smoothstep, lerp } from '../core/MathUtil.ts';

const CELL = 4; // meters per index cell
const MARGIN = 64; // extra indexed apron beyond the playable area
const HALF = PLAY_HALF + MARGIN;
const N = Math.ceil((HALF * 2) / CELL);

interface RoadCell {
  dist: number;
  roadY: number;
  kind: RoadKind;
  width: number;
}

export class Ground implements GroundSampler {
  private readonly seed: number;
  private roadCells: (RoadCell | null)[];
  private fieldCells: Int32Array;
  private fields: FieldSpec[];
  private craters: CraterSpec[];

  constructor(model: WorldModel) {
    this.seed = model.seed;
    this.fields = model.fields;
    this.craters = model.craters;
    this.roadCells = new Array<RoadCell | null>(N * N).fill(null);
    this.fieldCells = new Int32Array(N * N).fill(-1);
    this.rasterizeRoads(model);
    this.rasterizeFields(model);
  }

  // ------------------------------------------------------------ base relief

  /** Terrain before roads/craters — also used to profile road elevations. */
  baseHeight(x: number, z: number): number {
    const s = this.seed;
    // Real Normandy roll: the old amplitudes (11/2.6/0.55, then 72%
    // flattened near the village) rendered as a billiard table.
    let h = (fbm2D(x * 0.0016, z * 0.0016, s ^ 0x51, 4) - 0.5) * 16;
    h += (fbm2D(x * 0.007, z * 0.007, s ^ 0x52, 3) - 0.5) * 5.2;
    h += (fbm2D(x * 0.045, z * 0.045, s ^ 0x53, 2) - 0.5) * 1.1;
    // near-camera micro-undulation (≈15 m wavelength, ±15 cm)
    h += (fbm2D(x * 0.065, z * 0.065, s ^ 0x54, 2) - 0.5) * 0.3;
    // village still favors a plateau, but keeps visible undulation
    const r = Math.hypot(x, z);
    const flat = 1 - 0.55 * (1 - smoothstep(VILLAGE_RADIUS * 0.35, VILLAGE_RADIUS * 1.3, r));
    return h * flat;
  }

  height(x: number, z: number): number {
    let h = this.baseHeight(x, z);

    // road smoothing: pull terrain toward the road's low-passed profile
    const rc = this.roadCell(x, z);
    if (rc) {
      const featherStart = rc.width * 0.5;
      const featherEnd = rc.width * 0.5 + 4.5;
      const t = 1 - smoothstep(featherStart, featherEnd, rc.dist);
      if (t > 0) h = lerp(h, rc.roadY, t * 0.92);
      // drainage ditch along the shoulder — reads instantly as a real road
      const ditch =
        smoothstep(rc.width * 0.5 + 0.6, rc.width * 0.5 + 1.8, rc.dist) *
        (1 - smoothstep(rc.width * 0.5 + 1.8, rc.width * 0.5 + 3.6, rc.dist));
      h -= ditch * 0.38;
    }

    // crater bowls
    for (const c of this.craters) {
      const dx = x - c.x;
      const dz = z - c.z;
      const dSq = dx * dx + dz * dz;
      const R = c.radius + c.radius * 0.45; // rim extends past the bowl
      if (dSq > R * R) continue;
      const d = Math.sqrt(dSq);
      const bowl = 1 - smoothstep(0, c.radius, d);
      const rim = smoothstep(c.radius * 0.55, c.radius, d) * (1 - smoothstep(c.radius, R, d));
      h += -c.depth * bowl * bowl + rim * c.depth * 0.22;
    }
    return h;
  }

  /** Approximate surface normal via central differences. */
  normal(x: number, z: number, out: { x: number; y: number; z: number }): void {
    const e = 0.9;
    const hx = this.height(x + e, z) - this.height(x - e, z);
    const hz = this.height(x, z + e) - this.height(x, z - e);
    const inv = 1 / Math.hypot(hx, 2 * e, hz);
    out.x = -hx * inv;
    out.y = 2 * e * inv;
    out.z = -hz * inv;
  }

  roadMask(x: number, z: number): number {
    const rc = this.roadCell(x, z);
    if (!rc) return 0;
    // 1 at centreline → 0 at half-width (+ small shoulder)
    return clamp01(1 - smoothstep(rc.width * 0.32, rc.width * 0.5 + 1.2, rc.dist));
  }

  roadKind(x: number, z: number): RoadKind {
    return this.roadCell(x, z)?.kind ?? 'dirt';
  }

  /** Distance to the nearest road centreline (Infinity when far). */
  roadDistance(x: number, z: number): number {
    return this.roadCell(x, z)?.dist ?? Infinity;
  }

  fieldAt(x: number, z: number): FieldSpec | null {
    const i = this.cellIndex(x, z);
    if (i < 0) return null;
    const f = this.fieldCells[i];
    if (f === undefined || f < 0) return null;
    const field = this.fields[f];
    if (!field) return null;
    return pointInPolygon(x, z, field.polygon) ? field : null;
  }

  craterMask(x: number, z: number): number {
    let m = 0;
    for (const c of this.craters) {
      const dx = x - c.x;
      const dz = z - c.z;
      const R = c.radius * 1.5;
      if (dx * dx + dz * dz > R * R) continue;
      const d = Math.hypot(dx, dz);
      m = Math.max(m, 1 - smoothstep(c.radius * 0.8, R, d));
    }
    return m;
  }

  // ------------------------------------------------------------- indexing

  private cellIndex(x: number, z: number): number {
    const cx = Math.floor((x + HALF) / CELL);
    const cz = Math.floor((z + HALF) / CELL);
    if (cx < 0 || cz < 0 || cx >= N || cz >= N) return -1;
    return cz * N + cx;
  }

  private roadCell(x: number, z: number): RoadCell | null {
    const i = this.cellIndex(x, z);
    return i >= 0 ? (this.roadCells[i] ?? null) : null;
  }

  private rasterizeRoads(model: WorldModel): void {
    for (const road of model.roads.roads) {
      // low-passed elevation profile along the polyline
      const ys: number[] = road.points.map((p) => this.baseHeight(p.x, p.z));
      const smoothYs: number[] = ys.map((_, i) => {
        let sum = 0;
        let n = 0;
        for (let k = -6; k <= 6; k++) {
          const y = ys[i + k];
          if (y !== undefined) {
            sum += y;
            n++;
          }
        }
        return n > 0 ? sum / n : (ys[i] ?? 0);
      });

      const reach = road.width * 0.5 + 6.5;
      for (let s = 0; s < road.points.length - 1; s++) {
        const a = road.points[s];
        const b = road.points[s + 1];
        const ya = smoothYs[s] ?? 0;
        const yb = smoothYs[s + 1] ?? 0;
        if (!a || !b) continue;
        const minX = Math.min(a.x, b.x) - reach;
        const maxX = Math.max(a.x, b.x) + reach;
        const minZ = Math.min(a.z, b.z) - reach;
        const maxZ = Math.max(a.z, b.z) + reach;
        const c0x = Math.max(0, Math.floor((minX + HALF) / CELL));
        const c1x = Math.min(N - 1, Math.floor((maxX + HALF) / CELL));
        const c0z = Math.max(0, Math.floor((minZ + HALF) / CELL));
        const c1z = Math.min(N - 1, Math.floor((maxZ + HALF) / CELL));
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const lenSq = dx * dx + dz * dz;
        for (let cz = c0z; cz <= c1z; cz++) {
          for (let cx = c0x; cx <= c1x; cx++) {
            const px = cx * CELL - HALF + CELL / 2;
            const pz = cz * CELL - HALF + CELL / 2;
            let t = lenSq > 0 ? ((px - a.x) * dx + (pz - a.z) * dz) / lenSq : 0;
            t = t < 0 ? 0 : t > 1 ? 1 : t;
            const nx = a.x + t * dx;
            const nz = a.z + t * dz;
            const d = Math.hypot(px - nx, pz - nz);
            if (d > reach) continue;
            const idx = cz * N + cx;
            const existing = this.roadCells[idx];
            if (!existing || d < existing.dist) {
              this.roadCells[idx] = {
                dist: d,
                roadY: lerp(ya, yb, t),
                kind: road.kind,
                width: road.width,
              };
            }
          }
        }
      }
    }
  }

  private rasterizeFields(model: WorldModel): void {
    model.fields.forEach((field, fi) => {
      let minX = Infinity;
      let maxX = -Infinity;
      let minZ = Infinity;
      let maxZ = -Infinity;
      for (const p of field.polygon) {
        minX = Math.min(minX, p.x);
        maxX = Math.max(maxX, p.x);
        minZ = Math.min(minZ, p.z);
        maxZ = Math.max(maxZ, p.z);
      }
      const c0x = Math.max(0, Math.floor((minX + HALF) / CELL));
      const c1x = Math.min(N - 1, Math.floor((maxX + HALF) / CELL));
      const c0z = Math.max(0, Math.floor((minZ + HALF) / CELL));
      const c1z = Math.min(N - 1, Math.floor((maxZ + HALF) / CELL));
      for (let cz = c0z; cz <= c1z; cz++) {
        for (let cx = c0x; cx <= c1x; cx++) {
          const px = cx * CELL - HALF + CELL / 2;
          const pz = cz * CELL - HALF + CELL / 2;
          if (pointInPolygon(px, pz, field.polygon)) {
            this.fieldCells[cz * N + cx] = fi;
          }
        }
      }
    });
  }
}
