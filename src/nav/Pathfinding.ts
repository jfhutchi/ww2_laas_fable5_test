/**
 * A* pathfinding over the NavGrid with a binary heap, octile heuristic and
 * string-pulling smoothing. Deterministic: ties broken by cell index.
 * Vehicles and infantry use different passability + cost masks.
 */

import { NAV_CELL, NAV_N, NavGrid } from './NavGrid.ts';

export interface PathPoint {
  x: number;
  z: number;
}

const SQRT2 = Math.SQRT2;
const MAX_EXPANSIONS = 140000;

// reusable buffers (single-threaded sim)
const gScore = new Float32Array(NAV_N * NAV_N);
const parent = new Int32Array(NAV_N * NAV_N);
const closedGen = new Int32Array(NAV_N * NAV_N);
const openGen = new Int32Array(NAV_N * NAV_N);
let generation = 0;

class Heap {
  private items: number[] = [];
  private priorities: number[] = [];

  get size(): number {
    return this.items.length;
  }

  clear(): void {
    this.items.length = 0;
    this.priorities.length = 0;
  }

  push(item: number, priority: number): void {
    this.items.push(item);
    this.priorities.push(priority);
    let i = this.items.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if ((this.priorities[p] ?? 0) <= (this.priorities[i] ?? 0)) break;
      this.swap(i, p);
      i = p;
    }
  }

  pop(): number {
    const top = this.items[0] ?? -1;
    const lastItem = this.items.pop();
    const lastPri = this.priorities.pop();
    if (this.items.length > 0 && lastItem !== undefined && lastPri !== undefined) {
      this.items[0] = lastItem;
      this.priorities[0] = lastPri;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < this.items.length && (this.priorities[l] ?? 0) < (this.priorities[m] ?? 0)) m = l;
        if (r < this.items.length && (this.priorities[r] ?? 0) < (this.priorities[m] ?? 0)) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return top;
  }

  private swap(a: number, b: number): void {
    const ti = this.items[a] ?? 0;
    this.items[a] = this.items[b] ?? 0;
    this.items[b] = ti;
    const tp = this.priorities[a] ?? 0;
    this.priorities[a] = this.priorities[b] ?? 0;
    this.priorities[b] = tp;
  }
}

const heap = new Heap();

function octile(ax: number, az: number, bx: number, bz: number): number {
  const dx = Math.abs(ax - bx);
  const dz = Math.abs(az - bz);
  return dx > dz ? dx + (SQRT2 - 1) * dz : dz + (SQRT2 - 1) * dx;
}

/**
 * Find a path in world coordinates. Returns null when unreachable (caller
 * falls back to direct movement toward the goal).
 */
export function findPath(
  grid: NavGrid,
  fromX: number,
  fromZ: number,
  toX: number,
  toZ: number,
  vehicle: boolean,
): PathPoint[] | null {
  const passable = vehicle
    ? (cx: number, cz: number): boolean => grid.vehiclePassable(cx, cz)
    : (cx: number, cz: number): boolean => grid.infantryPassable(cx, cz);

  let sx = NavGrid.toCell(fromX);
  let sz = NavGrid.toCell(fromZ);
  let tx = NavGrid.toCell(toX);
  let tz = NavGrid.toCell(toZ);
  if (!NavGrid.inBounds(sx, sz) || !NavGrid.inBounds(tx, tz)) return null;

  // nudge endpoints to nearest passable cell (spiral search)
  const sFix = nearestPassable(sx, sz, passable);
  const tFix = nearestPassable(tx, tz, passable);
  if (!sFix || !tFix) return null;
  sx = sFix.cx;
  sz = sFix.cz;
  tx = tFix.cx;
  tz = tFix.cz;

  generation++;
  heap.clear();
  const startI = NavGrid.index(sx, sz);
  const goalI = NavGrid.index(tx, tz);
  gScore[startI] = 0;
  parent[startI] = -1;
  openGen[startI] = generation;
  heap.push(startI, octile(sx, sz, tx, tz));

  let found = false;
  let expansions = 0;
  let bestI = startI;
  let bestH = octile(sx, sz, tx, tz);

  while (heap.size > 0 && expansions < MAX_EXPANSIONS) {
    const cur = heap.pop();
    if (cur < 0) break;
    if ((closedGen[cur] ?? 0) === generation) continue;
    closedGen[cur] = generation;
    expansions++;
    if (cur === goalI) {
      found = true;
      break;
    }
    const cx = cur % NAV_N;
    const cz = Math.floor(cur / NAV_N);
    const h = octile(cx, cz, tx, tz);
    if (h < bestH) {
      bestH = h;
      bestI = cur;
    }

    for (let d = 0; d < 8; d++) {
      const dx = DX[d] ?? 0;
      const dz = DZ[d] ?? 0;
      const nx = cx + dx;
      const nz = cz + dz;
      if (!NavGrid.inBounds(nx, nz)) continue;
      if (!passable(nx, nz)) continue;
      // no diagonal corner cutting
      if (dx !== 0 && dz !== 0 && (!passable(cx + dx, cz) || !passable(cx, cz + dz))) continue;
      const ni = NavGrid.index(nx, nz);
      if ((closedGen[ni] ?? 0) === generation) continue;
      const stepCost = (dx !== 0 && dz !== 0 ? SQRT2 : 1) * grid.moveCost(nx, nz, vehicle);
      const g = (gScore[cur] ?? 0) + stepCost;
      if ((openGen[ni] ?? 0) === generation && g >= (gScore[ni] ?? Infinity)) continue;
      gScore[ni] = g;
      parent[ni] = cur;
      openGen[ni] = generation;
      heap.push(ni, g + octile(nx, nz, tx, tz) * 1.001);
    }
  }

  const endI = found ? goalI : bestI;
  if (!found && bestH > octile(sx, sz, tx, tz) * 0.9) return null; // made no progress

  // reconstruct
  const cells: number[] = [];
  let walk = endI;
  let guard = 0;
  while (walk >= 0 && guard++ < 100000) {
    cells.push(walk);
    walk = parent[walk] ?? -1;
  }
  cells.reverse();

  // string pulling: keep waypoints only where direct line is blocked
  const pts: PathPoint[] = [];
  let anchor = 0;
  pts.push(cellCenter(cells[0] ?? startI));
  for (let i = 2; i < cells.length; i++) {
    const a = cells[anchor] ?? startI;
    const c = cells[i] ?? endI;
    if (!lineClear(grid, a, c, vehicle)) {
      anchor = i - 1;
      pts.push(cellCenter(cells[anchor] ?? endI));
    }
  }
  pts.push(cellCenter(cells[cells.length - 1] ?? endI));
  // final exact goal (if the goal cell was reachable it is passable terrain)
  if (found) pts[pts.length - 1] = { x: toX, z: toZ };
  return pts;
}

const DX = [1, -1, 0, 0, 1, 1, -1, -1] as const;
const DZ = [0, 0, 1, -1, 1, -1, 1, -1] as const;

function cellCenter(i: number): PathPoint {
  return { x: NavGrid.toWorld(i % NAV_N), z: NavGrid.toWorld(Math.floor(i / NAV_N)) };
}

function nearestPassable(
  cx: number,
  cz: number,
  passable: (cx: number, cz: number) => boolean,
): { cx: number; cz: number } | null {
  if (passable(cx, cz)) return { cx, cz };
  for (let r = 1; r <= 14; r++) {
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const nx = cx + dx;
        const nz = cz + dz;
        if (NavGrid.inBounds(nx, nz) && passable(nx, nz)) return { cx: nx, cz: nz };
      }
    }
  }
  return null;
}

/** DDA line test between two cell indices. */
function lineClear(grid: NavGrid, a: number, b: number, vehicle: boolean): boolean {
  let x0 = a % NAV_N;
  let z0 = Math.floor(a / NAV_N);
  const x1 = b % NAV_N;
  const z1 = Math.floor(b / NAV_N);
  const dx = Math.abs(x1 - x0);
  const dz = Math.abs(z1 - z0);
  const sx = x0 < x1 ? 1 : -1;
  const sz = z0 < z1 ? 1 : -1;
  let err = dx - dz;
  const passable = vehicle
    ? (cx: number, cz: number): boolean => grid.vehiclePassable(cx, cz)
    : (cx: number, cz: number): boolean => grid.infantryPassable(cx, cz);
  let guard = 0;
  while (guard++ < 4000) {
    if (!passable(x0, z0)) return false;
    if (x0 === x1 && z0 === z1) return true;
    const e2 = 2 * err;
    if (e2 > -dz) {
      err -= dz;
      x0 += sx;
    }
    if (e2 < dx) {
      err += dx;
      z0 += sz;
    }
  }
  return false;
}

/**
 * Snap a world position to the nearest cell passable for the mover type.
 * Used for spawn/teleport placement so no unit ever starts inside a wall.
 */
export function snapToPassable(grid: NavGrid, x: number, z: number, vehicle: boolean): { x: number; z: number } {
  const passable = vehicle
    ? (cx: number, cz: number): boolean => grid.vehiclePassable(cx, cz)
    : (cx: number, cz: number): boolean => grid.infantryPassable(cx, cz);
  const cx = NavGrid.toCell(x);
  const cz = NavGrid.toCell(z);
  if (NavGrid.inBounds(cx, cz) && passable(cx, cz)) return { x, z };
  const fixed = nearestPassable(cx, cz, passable);
  if (!fixed) return { x, z };
  return { x: NavGrid.toWorld(fixed.cx), z: NavGrid.toWorld(fixed.cz) };
}

/** Straight-line world distance along a path. */
export function pathLength(pts: readonly PathPoint[]): number {
  let len = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    if (a && b) len += Math.hypot(b.x - a.x, b.z - a.z);
  }
  return len;
}

export { NAV_CELL };
