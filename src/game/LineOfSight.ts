/**
 * Line-of-sight: 2.5D raycast across the NavGrid blocker heights + terrain
 * profile + dynamic smoke. Units see from an eye height; buildings and
 * hedgerows occlude, low walls occlude prone-height only, smoke accumulates
 * opacity along the ray.
 */

import { NAV_CELL, NAV_N, NavGrid } from '../nav/NavGrid.ts';
import type { Ground } from '../world/Ground.ts';

export interface LosQuery {
  fromX: number;
  fromZ: number;
  fromEye: number; // eye height above terrain
  toX: number;
  toZ: number;
  toEye: number;
}

/** Smoke opacity (0..255 per cell) integrated over meters that fully blocks. */
const SMOKE_BLOCK = 340;

export class LineOfSight {
  constructor(
    private grid: NavGrid,
    private ground: Ground,
  ) {}

  /**
   * True when `to` is visible from `from`. Walks cells with DDA, comparing
   * the sight ray height against terrain + blocker heights and integrating
   * smoke opacity.
   */
  check(q: LosQuery): boolean {
    const y0 = this.ground.height(q.fromX, q.fromZ) + q.fromEye;
    const y1 = this.ground.height(q.toX, q.toZ) + q.toEye;
    const dx = q.toX - q.fromX;
    const dz = q.toZ - q.fromZ;
    const dist = Math.hypot(dx, dz);
    if (dist < NAV_CELL) return true;

    const steps = Math.ceil(dist / (NAV_CELL * 0.85));
    let smokeAccum = 0;
    const stepLen = dist / steps;

    for (let s = 1; s < steps; s++) {
      const t = s / steps;
      const x = q.fromX + dx * t;
      const z = q.fromZ + dz * t;
      const rayY = y0 + (y1 - y0) * t;

      // terrain occlusion (ridges)
      const terrY = this.ground.height(x, z);
      if (terrY > rayY + 0.25) return false;

      const cx = NavGrid.toCell(x);
      const cz = NavGrid.toCell(z);
      if (!NavGrid.inBounds(cx, cz)) continue;
      const i = cz * NAV_N + cx;

      // blocker heights (buildings, hedges, walls, wrecks)
      const blockH = this.grid.sightHeight[i] ?? 0;
      if (blockH > 0 && terrY + blockH > rayY + 0.15) {
        // near the endpoints a unit can see/shoot over its own cover
        const endFrac = Math.min(t, 1 - t) * dist;
        if (endFrac > 3.2) return false;
      }

      // smoke
      const sm = this.grid.smoke[i] ?? 0;
      if (sm > 0) {
        smokeAccum += sm * stepLen;
        if (smokeAccum > SMOKE_BLOCK) return false;
      }
    }
    return true;
  }
}
