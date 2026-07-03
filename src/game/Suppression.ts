/**
 * Suppression: incoming fire pins infantry and gun crews, reducing accuracy
 * and movement. Accumulated by the weapon systems (near misses, MG bursts,
 * HE blasts) and decayed here; cover reduces accumulation.
 */

import type { GameState } from './GameState.ts';
import { ARCHETYPES } from './Types.ts';

const DECAY_PER_S = 0.16;
const PIN_ON = 0.75;
const PIN_OFF = 0.42;

export class Suppression {
  readonly name = 'suppression';

  tick(gs: GameState, dt: number): void {
    for (const u of gs.units) {
      if (!u.alive) continue;
      const arch = ARCHETYPES[u.cls];
      if (arch.kind === 'vehicle') {
        u.suppression = 0;
        u.pinned = false;
        continue;
      }
      // decay — faster in cover (troops rally behind walls)
      const decay = DECAY_PER_S * (1 + u.inCoverQuality * 0.7) * dt;
      u.suppression = Math.max(0, u.suppression - decay);
      if (!u.pinned && u.suppression >= PIN_ON) {
        u.pinned = true;
        gs.bus.emit('unit:suppressed', { unitId: u.id });
      } else if (u.pinned && u.suppression <= PIN_OFF) {
        u.pinned = false;
      }
    }
  }

  /** Called by weapon/damage systems when fire lands near infantry. */
  static apply(gs: GameState, u: (typeof gs.units)[number], amount: number): void {
    const arch = ARCHETYPES[u.cls];
    if (arch.kind === 'vehicle') return;
    const coverReduce = 1 - u.inCoverQuality * 0.45;
    u.suppression = Math.min(1.25, u.suppression + (amount * coverReduce) / arch.nerve);
  }
}
