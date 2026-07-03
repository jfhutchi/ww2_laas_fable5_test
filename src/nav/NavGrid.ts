/**
 * Navigation + blocker grid derived from the WorldModel. One grid serves
 * three consumers with different masks:
 *  - vehicle pathfinding (blocked by buildings, hedgerows, high walls, wrecks)
 *  - infantry pathfinding (blocked by buildings; hedgerow gaps/gates pass)
 *  - line-of-sight heights (buildings, hedgerows, walls + dynamic smoke)
 * Cell size 2.5 m over the playable square.
 */

import { PLAY_HALF } from '../world/WorldConst.ts';
import type { WorldModel } from '../world/WorldTypes.ts';
import type { Ground } from '../world/Ground.ts';

export const NAV_CELL = 2.5;
export const NAV_N = Math.ceil((PLAY_HALF * 2) / NAV_CELL); // 640

// bit flags per cell
export const F_BUILDING = 1; // solid structure — blocks everyone + sight
export const F_HEDGE = 2; // hedgerow — blocks vehicles + sight; infantry slow
export const F_WALL = 4; // low stone wall — cover; slow for all, sight partial
export const F_FENCE = 8; // cosmetic cover
export const F_ROAD = 16; // fast movement
export const F_CRATER = 32; // rough ground
export const F_RUIN = 64; // rubble field — infantry cover, vehicle slow/block
export const F_WRECK = 128; // destroyed vehicle — blocks vehicles, cover for inf

export class NavGrid {
  /** Static flags from the world layout. */
  readonly flags = new Uint8Array(NAV_N * NAV_N);
  /** Sight-blocking height above terrain per cell (meters). */
  readonly sightHeight = new Float32Array(NAV_N * NAV_N);
  /** Dynamic smoke density 0..255 (combat adds, decays over time). */
  readonly smoke = new Uint8Array(NAV_N * NAV_N);
  /** Dynamic wreck occupancy count per cell. */
  private wreckCount = new Uint8Array(NAV_N * NAV_N);

  constructor(model: WorldModel, ground: Ground) {
    this.rasterize(model, ground);
  }

  static index(cx: number, cz: number): number {
    return cz * NAV_N + cx;
  }

  static toCell(v: number): number {
    return Math.floor((v + PLAY_HALF) / NAV_CELL);
  }

  static toWorld(c: number): number {
    return c * NAV_CELL - PLAY_HALF + NAV_CELL / 2;
  }

  static inBounds(cx: number, cz: number): boolean {
    return cx >= 0 && cz >= 0 && cx < NAV_N && cz < NAV_N;
  }

  flagsAt(x: number, z: number): number {
    const cx = NavGrid.toCell(x);
    const cz = NavGrid.toCell(z);
    if (!NavGrid.inBounds(cx, cz)) return F_BUILDING;
    return this.flags[NavGrid.index(cx, cz)] ?? 0;
  }

  /** True if a vehicle may occupy the cell. */
  vehiclePassable(cx: number, cz: number): boolean {
    if (!NavGrid.inBounds(cx, cz)) return false;
    const f = this.flags[NavGrid.index(cx, cz)] ?? 0;
    return (f & (F_BUILDING | F_HEDGE | F_RUIN | F_WRECK)) === 0;
  }

  /** True if infantry may occupy the cell. */
  infantryPassable(cx: number, cz: number): boolean {
    if (!NavGrid.inBounds(cx, cz)) return false;
    const f = this.flags[NavGrid.index(cx, cz)] ?? 0;
    return (f & (F_BUILDING | F_HEDGE)) === 0;
  }

  /** Movement cost multiplier ≥ 1 is slow, < 1 is fast (roads). */
  moveCost(cx: number, cz: number, vehicle: boolean): number {
    const f = this.flags[NavGrid.index(cx, cz)] ?? 0;
    let c = 1;
    if (f & F_ROAD) c = vehicle ? 0.62 : 0.85;
    if (f & F_CRATER) c *= vehicle ? 1.9 : 1.35;
    if (f & F_WALL) c *= vehicle ? 2.6 : 1.7; // climbing/crushing a low wall
    if (f & F_FENCE) c *= vehicle ? 1.15 : 1.05;
    if (!vehicle && f & F_RUIN) c *= 1.4;
    return c;
  }

  addWreck(x: number, z: number, radius: number): void {
    this.stampDisc(x, z, radius, (i) => {
      const count = this.wreckCount[i] ?? 0;
      this.wreckCount[i] = Math.min(255, count + 1);
      const f = this.flags[i] ?? 0;
      this.flags[i] = f | F_WRECK;
      if ((this.sightHeight[i] ?? 0) < 1.8) this.sightHeight[i] = 1.8;
    });
  }

  addSmoke(x: number, z: number, radius: number, density: number): void {
    this.stampDisc(x, z, radius, (i) => {
      this.smoke[i] = Math.min(255, (this.smoke[i] ?? 0) + density);
    });
  }

  decaySmoke(amount: number): void {
    for (let i = 0; i < this.smoke.length; i++) {
      const s = this.smoke[i] ?? 0;
      if (s > 0) this.smoke[i] = Math.max(0, s - amount);
    }
  }

  /** Break a wall/hedge cell open (HE hits, tank crushing). */
  breach(x: number, z: number, radius: number): void {
    this.stampDisc(x, z, radius, (i) => {
      const f = this.flags[i] ?? 0;
      if (f & (F_WALL | F_HEDGE | F_FENCE)) {
        this.flags[i] = f & ~(F_WALL | F_HEDGE | F_FENCE);
        const sh = this.sightHeight[i] ?? 0;
        if (sh > 0 && sh < 4) this.sightHeight[i] = 0;
      }
    });
  }

  private stampDisc(x: number, z: number, radius: number, fn: (index: number) => void): void {
    const c0x = Math.max(0, NavGrid.toCell(x - radius));
    const c1x = Math.min(NAV_N - 1, NavGrid.toCell(x + radius));
    const c0z = Math.max(0, NavGrid.toCell(z - radius));
    const c1z = Math.min(NAV_N - 1, NavGrid.toCell(z + radius));
    for (let cz = c0z; cz <= c1z; cz++) {
      for (let cx = c0x; cx <= c1x; cx++) {
        const wx = NavGrid.toWorld(cx);
        const wz = NavGrid.toWorld(cz);
        const dx = wx - x;
        const dz = wz - z;
        if (dx * dx + dz * dz <= radius * radius) fn(NavGrid.index(cx, cz));
      }
    }
  }

  // -------------------------------------------------------- rasterization

  private rasterize(model: WorldModel, ground: Ground): void {
    // roads + craters from the ground sampler
    for (let cz = 0; cz < NAV_N; cz++) {
      for (let cx = 0; cx < NAV_N; cx++) {
        const x = NavGrid.toWorld(cx);
        const z = NavGrid.toWorld(cz);
        const i = NavGrid.index(cx, cz);
        let f = this.flags[i] ?? 0;
        if (ground.roadMask(x, z) > 0.45) f |= F_ROAD;
        if (ground.craterMask(x, z) > 0.5) f |= F_CRATER;
        this.flags[i] = f;
      }
    }

    // buildings: rotated rect footprint (+0.8 m skirt)
    for (const b of model.buildings) {
      const skirt = 0.8;
      const hw = b.halfW + skirt;
      const hd = b.halfD + skirt;
      const reach = Math.hypot(hw, hd);
      const c0x = Math.max(0, NavGrid.toCell(b.x - reach));
      const c1x = Math.min(NAV_N - 1, NavGrid.toCell(b.x + reach));
      const c0z = Math.max(0, NavGrid.toCell(b.z - reach));
      const c1z = Math.min(NAV_N - 1, NavGrid.toCell(b.z + reach));
      const cos = Math.cos(b.rotation);
      const sin = Math.sin(b.rotation);
      const height =
        b.damage === 'ruined' ? b.wallHeight * 0.45 : b.wallHeight + (b.kind === 'church' ? 10 : 2.5);
      for (let cz = c0z; cz <= c1z; cz++) {
        for (let cx = c0x; cx <= c1x; cx++) {
          const wx = NavGrid.toWorld(cx) - b.x;
          const wz = NavGrid.toWorld(cz) - b.z;
          // world → local (inverse rotation)
          const lx = wx * cos + wz * sin;
          const lz = -wx * sin + wz * cos;
          if (Math.abs(lx) <= hw && Math.abs(lz) <= hd) {
            const i = NavGrid.index(cx, cz);
            const f = this.flags[i] ?? 0;
            this.flags[i] = f | (b.damage === 'ruined' ? F_RUIN : F_BUILDING);
            if ((this.sightHeight[i] ?? 0) < height) this.sightHeight[i] = height;
          }
        }
      }
    }

    // barriers: walk segments, stamp cells
    for (const seg of model.barriers) {
      const len = Math.hypot(seg.x1 - seg.x0, seg.z1 - seg.z0);
      const steps = Math.max(1, Math.ceil(len / (NAV_CELL * 0.5)));
      // broken sections leave a gap in the middle
      const gapStart = 0.5 - seg.broken * 0.35;
      const gapEnd = 0.5 + seg.broken * 0.35;
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        if (seg.broken > 0.25 && t > gapStart && t < gapEnd) continue;
        const x = seg.x0 + (seg.x1 - seg.x0) * t;
        const z = seg.z0 + (seg.z1 - seg.z0) * t;
        const cx = NavGrid.toCell(x);
        const cz = NavGrid.toCell(z);
        if (!NavGrid.inBounds(cx, cz)) continue;
        const i = NavGrid.index(cx, cz);
        const f = this.flags[i] ?? 0;
        const flag = seg.kind === 'hedgerow' ? F_HEDGE : seg.kind === 'stone-wall' ? F_WALL : F_FENCE;
        this.flags[i] = f | flag;
        const sightH = seg.kind === 'hedgerow' ? seg.height : seg.kind === 'stone-wall' ? seg.height : 0;
        if ((this.sightHeight[i] ?? 0) < sightH) this.sightHeight[i] = sightH;
      }
    }
  }
}
