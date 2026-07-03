/**
 * Enemy defensive AI + friendly infantry self-preservation.
 *
 * The defense is not omniscient: it acts only on what its own units can see
 * (shared spotting intel with a short memory). Behaviors per role:
 *  - infantry: hold assigned positions, dive for cover under fire, fall back
 *    toward the village when flanked or mauled, counter-attack the capture
 *    zone when the player's progress climbs;
 *  - MG teams: swing their arc onto threats, displace when flanked;
 *  - AT gun: emplaced — holds its lane, crew abandons only when broken;
 *  - armor: engages known player armor at standoff range, repositions when
 *    flanked or damaged;
 *  - reinforcements: sustained attack-move onto the crossroads.
 * Friendly infantry additionally auto-seek nearby cover when suppressed.
 */

import type { GameState } from '../game/GameState.ts';
import { ARCHETYPES, type UnitState } from '../game/Types.ts';
import { Spotting } from '../game/Spotting.ts';
import { angleDelta, clamp01, dist2D } from '../core/MathUtil.ts';
import { NAV_N, NavGrid, F_BUILDING, F_WALL, F_HEDGE, F_RUIN, F_WRECK } from '../nav/NavGrid.ts';

interface Contact {
  x: number;
  z: number;
  time: number;
  vehicle: boolean;
}

const MEMORY_S = 6;

export class EnemyAI {
  readonly name = 'enemy-ai';
  private spotter = new Spotting();
  /** Shared enemy-side intel: last known player unit positions. */
  private contacts = new Map<number, Contact>();
  private acc = 0;
  private reactionDelay = 0;
  private started = false;

  tick(gs: GameState, dt: number): void {
    if (!this.started) {
      this.started = true;
      this.reactionDelay = gs.tuning.enemyReactionS;
    }
    this.acc += dt;
    if (this.acc < 0.6) return;
    this.acc -= 0.6;

    // --- update shared intel from every living enemy's own vision
    const now = gs.missionTime;
    for (const p of gs.units) {
      if (p.side !== 'player' || !p.alive) continue;
      for (const e of gs.units) {
        if (e.side !== 'enemy' || !e.alive) continue;
        if (this.spotter.canSee(gs, e, p)) {
          this.contacts.set(p.id, { x: p.x, z: p.z, time: now, vehicle: ARCHETYPES[p.cls].kind === 'vehicle' });
          break;
        }
      }
    }
    for (const [id, c] of this.contacts) {
      const u = gs.byId.get(id);
      if (now - c.time > MEMORY_S || !u || !u.alive) this.contacts.delete(id);
    }

    // stagger unit decisions across ticks
    for (const u of gs.units) {
      if (!u.alive) continue;
      if (u.side === 'enemy') {
        if ((u.id + Math.floor(now / 0.6)) % 3 !== 0) continue;
        if (now < this.reactionDelay) continue;
        this.enemyBrain(gs, u, now);
      } else {
        this.friendlyReflexes(gs, u);
      }
    }
  }

  // -------------------------------------------------------------- enemies

  private nearestContact(u: UnitState, vehiclesOnly = false): Contact | null {
    let best: Contact | null = null;
    let bestD = Infinity;
    for (const c of this.contacts.values()) {
      if (vehiclesOnly && !c.vehicle) continue;
      const d = dist2D(u.x, u.z, c.x, c.z);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    return best;
  }

  private isFlanked(u: UnitState, c: Contact): boolean {
    const bearing = Math.atan2(c.z - u.z, c.x - u.x);
    return Math.abs(angleDelta(u.homeFacing, bearing)) > (2 * Math.PI) / 3 && dist2D(u.x, u.z, c.x, c.z) < 80;
  }

  private enemyBrain(gs: GameState, u: UnitState, now: number): void {
    const arch = ARCHETYPES[u.cls];
    const zone = gs.model.captureZone;
    const contact = this.nearestContact(u);
    const hurt = u.hp < arch.maxHp * 0.35;

    switch (u.aiRole) {
      case 'infantry': {
        // dive to cover when suppressed in the open
        if (u.suppression > 0.55 && u.inCoverQuality < 0.3) {
          const cover = this.findCover(gs, u, contact);
          if (cover) {
            gs.issueOrder(u, { type: 'move', x: cover.x, z: cover.z, targetId: -1 });
            return;
          }
        }
        // fall back when flanked or mauled
        if ((contact && this.isFlanked(u, contact)) || hurt) {
          const backX = u.homeX + (zone.x - u.homeX) * 0.55 + (u.id % 3) * 4 - 4;
          const backZ = u.homeZ + (zone.z - u.homeZ) * 0.55;
          if (dist2D(u.x, u.z, backX, backZ) > 12 && u.order.type !== 'move') {
            gs.issueOrder(u, { type: 'move', x: backX, z: backZ, targetId: -1 });
            u.homeFacing = contact ? Math.atan2(contact.z - u.z, contact.x - u.x) : u.homeFacing;
          }
          return;
        }
        // counter-attack the zone when the player is taking it
        if (gs.captureProgress > 0.35 && dist2D(u.x, u.z, zone.x, zone.z) > 40 && u.id % 2 === 0) {
          if (u.order.type === 'idle' || u.order.type === 'hold') {
            gs.issueOrder(u, { type: 'attack-move', x: zone.x + ((u.id * 7) % 21) - 10, z: zone.z + ((u.id * 11) % 21) - 10, targetId: -1 });
          }
          return;
        }
        // otherwise hold near home
        if (u.order.type === 'idle' && dist2D(u.x, u.z, u.homeX, u.homeZ) > 18) {
          gs.issueOrder(u, { type: 'move', x: u.homeX, z: u.homeZ, targetId: -1 });
        }
        break;
      }

      case 'mg': {
        if (contact) {
          // swing the arc onto the threat
          u.homeFacing = Math.atan2(contact.z - u.z, contact.x - u.x);
          if (this.isFlanked(u, contact) || hurt) {
            const cover = this.findCover(gs, u, contact);
            if (cover && u.order.type !== 'move') {
              gs.issueOrder(u, { type: 'move', x: cover.x, z: cover.z, targetId: -1 });
            }
          }
        }
        break;
      }

      case 'at': {
        // emplaced: the crew rotates the piece (Combat handles traverse).
        // Broken crews abandon (handled implicitly by death); nothing to do.
        break;
      }

      case 'armor': {
        const armorContact = this.nearestContact(u, true) ?? contact;
        if (!armorContact) {
          if (u.order.type === 'idle' && dist2D(u.x, u.z, u.homeX, u.homeZ) > 15) {
            gs.issueOrder(u, { type: 'move', x: u.homeX, z: u.homeZ, targetId: -1 });
          }
          return;
        }
        const d = dist2D(u.x, u.z, armorContact.x, armorContact.z);
        if ((this.isFlanked(u, armorContact) && u.hp < arch.maxHp * 0.75) || hurt) {
          // reposition: pull back away from the contact, hull toward it
          const away = Math.atan2(u.z - armorContact.z, u.x - armorContact.x);
          const rx = u.x + Math.cos(away) * 55;
          const rz = u.z + Math.sin(away) * 55;
          if (u.order.type !== 'move') gs.issueOrder(u, { type: 'move', x: rx, z: rz, targetId: -1 });
          return;
        }
        // engage at standoff: close to ~140 m of the last known position
        if (d > 150 && u.order.type !== 'attack-move') {
          const toward = Math.atan2(armorContact.z - u.z, armorContact.x - u.x);
          gs.issueOrder(u, {
            type: 'attack-move',
            x: armorContact.x - Math.cos(toward) * 120,
            z: armorContact.z - Math.sin(toward) * 120,
            targetId: -1,
          });
        }
        break;
      }

      case 'reinforcement': {
        // sustained push onto the crossroads
        if (u.order.type === 'idle') {
          gs.issueOrder(u, { type: 'attack-move', x: zone.x, z: zone.z, targetId: -1 });
        }
        break;
      }

      default:
        break;
    }
    void now;
  }

  // ------------------------------------------------------------ friendlies

  private friendlyReflexes(gs: GameState, u: UnitState): void {
    const arch = ARCHETYPES[u.cls];
    if (arch.kind !== 'infantry') return;
    // suppressed in the open with no orders → scramble to nearby cover
    if (u.suppression > 0.5 && u.inCoverQuality < 0.3 && (u.order.type === 'idle' || u.order.type === 'hold')) {
      const threat = this.nearestThreatTo(gs, u);
      const cover = this.findCover(gs, u, threat);
      if (cover) gs.issueOrder(u, { type: 'move', x: cover.x, z: cover.z, targetId: -1 });
    }
  }

  private nearestThreatTo(gs: GameState, u: UnitState): Contact | null {
    let best: Contact | null = null;
    let bestD = Infinity;
    for (const e of gs.units) {
      if (e.side === u.side || !e.alive || !e.spotted) continue;
      const d = dist2D(u.x, u.z, e.x, e.z);
      if (d < bestD) {
        bestD = d;
        best = { x: e.x, z: e.z, time: gs.missionTime, vehicle: ARCHETYPES[e.cls].kind === 'vehicle' };
      }
    }
    return best;
  }

  /**
   * Find a nearby cell adjacent to cover, preferring spots that put the
   * cover between the unit and the threat.
   */
  private findCover(gs: GameState, u: UnitState, threat: Contact | null): { x: number; z: number } | null {
    const cx = NavGrid.toCell(u.x);
    const cz = NavGrid.toCell(u.z);
    let best: { x: number; z: number } | null = null;
    let bestScore = -Infinity;
    const R = 8; // cells (= 20 m)
    for (let dz = -R; dz <= R; dz++) {
      for (let dx = -R; dx <= R; dx++) {
        const nx = cx + dx;
        const nz = cz + dz;
        if (!NavGrid.inBounds(nx, nz)) continue;
        if (!gs.nav.infantryPassable(nx, nz)) continue;
        // must be ADJACENT to a cover flag
        let adjacent = 0;
        for (const [ax, az] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const f = gs.nav.flags[(nz + az) * NAV_N + (nx + ax)] ?? 0;
          if (f & (F_WALL | F_HEDGE | F_RUIN | F_WRECK | F_BUILDING)) adjacent++;
        }
        if (adjacent === 0) continue;
        const wx = NavGrid.toWorld(nx);
        const wz = NavGrid.toWorld(nz);
        const dHome = dist2D(wx, wz, u.x, u.z);
        let score = adjacent * 2 - dHome * 0.3;
        if (threat) {
          // prefer positions further from the threat than the cover line
          const dThreat = dist2D(wx, wz, threat.x, threat.z);
          score += clamp01(dThreat / 100) * 3;
        }
        if (score > bestScore) {
          bestScore = score;
          best = { x: wx, z: wz };
        }
      }
    }
    return best;
  }
}
