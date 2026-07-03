/**
 * Capture zone state machine for the central crossroads.
 * States: Neutral → Capturing → Securing → Secured, with Contested and
 * Enemy Recapturing interruptions. Combined arms capture faster; scouts
 * alone capture slowly; enemy reinforcements trigger at 50% progress.
 */

import type { GameState } from './GameState.ts';
import { ARCHETYPES } from './Types.ts';

export type CaptureState =
  | 'Neutral'
  | 'Capturing'
  | 'Contested'
  | 'Securing'
  | 'Secured'
  | 'Enemy Recapturing';

const SECURE_THRESHOLD = 1.0; // progress to reach Securing
const SECURE_HOLD_S = 12; // hold with no contest to win
const BASE_RATE = 1 / 45; // full-progress seconds with weight 1

export class Capture {
  readonly name = 'capture';
  state: CaptureState = 'Neutral';
  /** 0..1 player capture progress. */
  progress = 0;
  /** Securing hold timer. */
  holdTime = 0;

  tick(gs: GameState, dt: number): void {
    const zone = gs.model.captureZone;
    let playerWeight = 0;
    let playerKinds = new Set<string>();
    let enemyInside = 0;

    for (const u of gs.units) {
      if (!u.alive) continue;
      const dx = u.x - zone.x;
      const dz = u.z - zone.z;
      if (dx * dx + dz * dz > zone.radius * zone.radius) continue;
      if (u.side === 'player') {
        const arch = ARCHETYPES[u.cls];
        playerWeight += arch.captureWeight;
        playerKinds.add(arch.kind);
      } else {
        enemyInside++;
      }
    }

    // combined arms bonus: armor + infantry together capture faster
    if (playerKinds.size >= 2) playerWeight *= 1.35;

    const prev = this.state;

    if (playerWeight > 0 && enemyInside > 0) {
      this.state = 'Contested';
      this.holdTime = 0;
      // progress frozen while contested
    } else if (playerWeight > 0) {
      if (this.progress < SECURE_THRESHOLD) {
        this.state = 'Capturing';
        this.progress = Math.min(SECURE_THRESHOLD, this.progress + BASE_RATE * playerWeight * dt);
        if (this.progress >= SECURE_THRESHOLD) {
          this.state = 'Securing';
          this.holdTime = 0;
        }
      } else {
        this.state = 'Securing';
        this.holdTime += dt;
        if (this.holdTime >= SECURE_HOLD_S) {
          this.state = 'Secured';
          gs.win();
        }
      }
    } else if (enemyInside > 0) {
      if (this.progress > 0) {
        this.state = 'Enemy Recapturing';
        this.progress = Math.max(0, this.progress - BASE_RATE * 0.8 * enemyInside * dt);
        this.holdTime = 0;
      } else {
        this.state = 'Neutral';
      }
    } else {
      // empty zone: progress decays very slowly, securing hold pauses
      if (this.state === 'Securing') {
        // pause hold — zone must be actively held
        this.holdTime = Math.max(0, this.holdTime - dt * 0.5);
        if (this.holdTime <= 0 && this.progress < SECURE_THRESHOLD) this.state = 'Capturing';
      } else if (this.progress > 0 && this.progress < SECURE_THRESHOLD) {
        this.progress = Math.max(0, this.progress - BASE_RATE * 0.12 * dt);
        this.state = this.progress > 0 ? 'Capturing' : 'Neutral';
        if (playerWeight === 0) this.state = this.progress > 0.02 ? this.state : 'Neutral';
      }
    }

    // reinforcements at 50%
    if (this.progress >= 0.5) gs.spawnReinforcements();

    gs.captureStateLabel = this.state;
    gs.captureProgress = this.progress;

    if (prev !== this.state) {
      gs.bus.emit('capture:state', { state: this.state, progress: this.progress });
    }
  }
}
