/**
 * Player command routing: selection bookkeeping, control groups, and the
 * translation of clicks/hotkeys into unit orders with group formation
 * offsets. Shared by the tactical mouse UI and the battery's test API —
 * both go through the exact same issue() calls.
 */

import type { GameState } from './GameState.ts';
import type { OrderType, UnitState } from './Types.ts';
import { ARCHETYPES } from './Types.ts';

export type CommandMode = 'normal' | 'attack-move' | 'attack-ground';

export class Commands {
  /** Currently selected unit ids (player side only). */
  readonly selection = new Set<number>();
  /** Pending click-mode from hotkeys (A = attack-move, G = attack ground). */
  mode: CommandMode = 'normal';
  private groups = new Map<number, number[]>();

  constructor(private gs: GameState) {}

  selectedUnits(): UnitState[] {
    const out: UnitState[] = [];
    for (const id of this.selection) {
      const u = this.gs.byId.get(id);
      if (u && u.alive && u.side === 'player') out.push(u);
    }
    return out;
  }

  select(ids: number[], additive: boolean): void {
    if (!additive) this.selection.clear();
    for (const id of ids) {
      const u = this.gs.byId.get(id);
      if (!u || !u.alive || u.side !== 'player') continue;
      if (additive && this.selection.has(id)) this.selection.delete(id);
      else this.selection.add(id);
    }
    this.gs.bus.emit('ui:selection', { count: this.selection.size });
  }

  selectAllPlayer(): number {
    this.selection.clear();
    for (const u of this.gs.units) {
      if (u.side === 'player' && u.alive) this.selection.add(u.id);
    }
    this.gs.bus.emit('ui:selection', { count: this.selection.size });
    return this.selection.size;
  }

  assignGroup(n: number): void {
    this.groups.set(n, [...this.selection]);
  }

  recallGroup(n: number): boolean {
    const g = this.groups.get(n);
    if (!g || g.length === 0) return false;
    this.select(g, false);
    return true;
  }

  /** Order the current selection to a point with a spread formation. */
  order(type: OrderType, x: number, z: number, targetId = -1): void {
    const units = this.selectedUnits();
    if (units.length === 0) return;

    // formation: vehicles in loose wedge, infantry in line, spacing by radius
    const n = units.length;
    const cols = Math.ceil(Math.sqrt(n));
    units.forEach((u, i) => {
      const arch = ARCHETYPES[u.cls];
      const row = Math.floor(i / cols);
      const col = i % cols;
      const spacing = arch.kind === 'vehicle' ? 9 : 6;
      const ox = (col - (cols - 1) / 2) * spacing;
      const oz = row * spacing;
      // rotate offsets to face from the group's centroid toward the goal
      const cx = units.reduce((s, uu) => s + uu.x, 0) / n;
      const cz = units.reduce((s, uu) => s + uu.z, 0) / n;
      const dir = Math.atan2(z - cz, x - cx);
      const latX = -Math.sin(dir);
      const latZ = Math.cos(dir);
      const bakX = -Math.cos(dir);
      const bakZ = -Math.sin(dir);
      const tx = type === 'attack-target' ? x : x + latX * ox + bakX * oz;
      const tz = type === 'attack-target' ? z : z + latZ * ox + bakZ * oz;
      this.gs.issueOrder(u, { type, x: tx, z: tz, targetId });
    });
    this.mode = 'normal';
  }

  stop(): void {
    for (const u of this.selectedUnits()) {
      u.path = null;
      u.targetId = -1;
      this.gs.issueOrder(u, { type: 'idle', x: u.x, z: u.z, targetId: -1 });
    }
  }

  hold(): void {
    for (const u of this.selectedUnits()) {
      u.path = null;
      this.gs.issueOrder(u, { type: 'hold', x: u.x, z: u.z, targetId: -1 });
    }
  }

  /** Remove dead units from selection (called each frame). */
  prune(): void {
    for (const id of [...this.selection]) {
      const u = this.gs.byId.get(id);
      if (!u || !u.alive) this.selection.delete(id);
    }
  }
}
