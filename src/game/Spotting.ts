/**
 * Spotting / fog-of-war: enemies are only revealed to the player when a
 * player unit has genuine line-of-sight within its sight range (scouts see
 * further). Spotted status lingers briefly after contact is lost so markers
 * do not strobe. The enemy AI uses the same LOS checks symmetrically via
 * canSee() — no omniscient AI.
 */

import type { GameState } from './GameState.ts';
import { ARCHETYPES, type UnitState } from './Types.ts';

const LINGER_S = 3.5;
/** Re-check cadence per unit (staggered by id). */
const PERIOD_S = 0.5;

export class Spotting {
  readonly name = 'spotting';
  private acc = 0;

  tick(gs: GameState, dt: number): void {
    this.acc += dt;
    const step = this.acc >= PERIOD_S;
    if (step) this.acc -= PERIOD_S;

    for (const enemy of gs.units) {
      if (enemy.side !== 'enemy' || !enemy.alive) continue;
      if (step) {
        const seen = this.seenByPlayer(gs, enemy);
        if (seen) {
          if (!enemy.spotted) gs.bus.emit('unit:spotted', { unitId: enemy.id, side: 'enemy' });
          enemy.spotted = true;
          enemy.spotLinger = LINGER_S;
        }
      }
      if (enemy.spotted && enemy.spotLinger > 0) {
        enemy.spotLinger -= dt;
        if (enemy.spotLinger <= 0) enemy.spotted = false;
      }
    }
  }

  private seenByPlayer(gs: GameState, enemy: UnitState): boolean {
    for (const u of gs.units) {
      if (u.side !== 'player' || !u.alive) continue;
      if (this.canSee(gs, u, enemy)) return true;
    }
    return false;
  }

  /** Symmetric LOS + range test used by spotting and AI targeting. */
  canSee(gs: GameState, viewer: UnitState, target: UnitState): boolean {
    const va = ARCHETYPES[viewer.cls];
    const dx = target.x - viewer.x;
    const dz = target.z - viewer.z;
    const distSq = dx * dx + dz * dz;
    // moving/firing targets are easier to notice; stationary emplacements harder
    let range = va.sight;
    if (target.vel < 0.3 && ARCHETYPES[target.cls].kind !== 'vehicle') range *= 0.72;
    if (distSq > range * range) return false;
    const viewerEye = va.kind === 'vehicle' ? 2.6 : 1.7;
    const targetEye = ARCHETYPES[target.cls].kind === 'vehicle' ? 2.2 : 1.4;
    return gs.los.check({
      fromX: viewer.x,
      fromZ: viewer.z,
      fromEye: viewerEye,
      toX: target.x,
      toZ: target.z,
      toEye: targetEye,
    });
  }
}
