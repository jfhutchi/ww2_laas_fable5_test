/**
 * Direct tank control: heavy-vehicle driving (throttle response, track
 * steering that pivots at low speed), turret chase toward the camera aim,
 * and manual cannon/MG fire that spawns the same projectiles and hitscan
 * bursts the autonomous combat system uses — one ballistics model.
 */

import type { GameState } from './GameState.ts';
import type { Combat } from './Combat.ts';
import { ARCHETYPES, type UnitState } from './Types.ts';
import { Suppression } from './Suppression.ts';
import { angleDelta, clamp, dist2D, turnToward } from '../core/MathUtil.ts';
import { NavGrid } from '../nav/NavGrid.ts';

export class DirectControl {
  readonly name = 'direct-control';
  /** Camera aim the turret chases (set from App each frame). */
  aimYaw = 0;
  aimPitch = 0;
  /** Fire requests latched between sim ticks. */
  wantFireCannon = false;
  wantFireMG = false;
  overdrive = false;

  /** Events for camera/HUD feedback. */
  onCannonFired: (() => void) | null = null;

  tick(gs: GameState, dt: number, combat: Combat, controlledId: number): void {
    const u = gs.byId.get(controlledId);
    if (!u || !u.alive || !u.directControl) return;
    const arch = ARCHETYPES[u.cls];

    // ---------- drive
    let maxSpeed = arch.speed * (this.overdrive ? 1.25 : 1);
    if (u.crits.mobility) maxSpeed *= 0.35;
    const throttle = clamp(u.driveThrottle, -1, 1);
    const steer = clamp(u.driveSteer, -1, 1);

    // track steering: full pivot rate at standstill, tighter at speed
    const speedFrac = Math.abs(u.vel) / Math.max(1, arch.speed);
    const turnRate = arch.turnRate * (1.15 - 0.45 * speedFrac);
    u.yaw += steer * turnRate * dt * (u.vel < -0.3 ? -1 : 1);

    // heavy acceleration / braking
    const target = throttle * maxSpeed * (throttle < 0 ? 0.45 : 1);
    const accel =
      Math.sign(target - u.vel) === Math.sign(u.vel) || u.vel === 0
        ? arch.speed * 0.42 // gaining
        : arch.speed * 1.6; // braking
    u.vel += clamp(target - u.vel, -accel * dt, accel * dt);
    if (throttle === 0 && Math.abs(u.vel) < 0.25) u.vel = 0;

    // integrate with collision slide (same rules as autonomous movement)
    const stepX = Math.cos(u.yaw) * u.vel * dt;
    const stepZ = Math.sin(u.yaw) * u.vel * dt;
    const pass = (x: number, z: number): boolean =>
      gs.nav.vehiclePassable(NavGrid.toCell(x), NavGrid.toCell(z));
    if (pass(u.x + stepX, u.z + stepZ)) {
      u.x += stepX;
      u.z += stepZ;
    } else if (pass(u.x + stepX, u.z)) {
      u.x += stepX;
      u.vel *= 0.7;
    } else if (pass(u.x, u.z + stepZ)) {
      u.z += stepZ;
      u.vel *= 0.7;
    } else {
      u.vel = 0;
    }
    u.y = gs.ground.height(u.x, u.z);

    // ---------- turret chase
    if (!u.crits.turret && arch.turretRate > 0) {
      u.turretYaw = turnToward(u.turretYaw, this.aimYaw, arch.turretRate * dt);
    }

    // ---------- weapons
    for (const ws of u.weapons) {
      if (ws.cooldown > 0) ws.cooldown -= dt;
      ws.reloadLeft = Math.max(0, ws.cooldown);
    }

    if (this.wantFireCannon) {
      this.wantFireCannon = false;
      const w = arch.weapons[0];
      const ws = u.weapons[0];
      if (w && ws && ws.cooldown <= 0 && Math.abs(angleDelta(u.turretYaw, this.aimYaw)) < 0.12) {
        ws.cooldown = w.reload;
        gs.shotsByPlayer++;
        gs.projectilesFired++;
        gs.audioEvents++;
        const mh = 2.3;
        const dirX = Math.cos(u.turretYaw);
        const dirZ = Math.sin(u.turretYaw);
        const pitch = clamp(this.aimPitch, -0.12, 0.3);
        gs.bus.emit('combat:shot', {
          shooterId: u.id,
          side: u.side,
          weapon: 'cannon',
          x: u.x + dirX * 2.4,
          y: u.y + mh,
          z: u.z + dirZ * 2.4,
        });
        combat.projectiles.push({
          id: 900000 + gs.projectilesFired,
          shooterId: u.id,
          side: u.side,
          weapon: w,
          x: u.x + dirX * 2.6,
          y: u.y + mh,
          z: u.z + dirZ * 2.6,
          vx: dirX * Math.cos(pitch) * w.projectileSpeed,
          vy: Math.sin(pitch) * w.projectileSpeed,
          vz: dirZ * Math.cos(pitch) * w.projectileSpeed,
          targetId: -1,
          life: 4,
          gravity: false,
        });
        this.onCannonFired?.();
      }
    }

    if (this.wantFireMG) {
      this.wantFireMG = false;
      const wi = arch.weapons.findIndex((w) => w.kind === 'mg');
      const w = wi >= 0 ? arch.weapons[wi] : undefined;
      const ws = wi >= 0 ? u.weapons[wi] : undefined;
      if (w && ws && ws.cooldown <= 0) {
        ws.cooldown = w.reload * 0.55;
        gs.shotsByPlayer++;
        gs.audioEvents++;
        gs.bus.emit('combat:shot', {
          shooterId: u.id,
          side: u.side,
          weapon: 'mg',
          x: u.x + Math.cos(u.turretYaw) * 2.2,
          y: u.y + 2.1,
          z: u.z + Math.sin(u.turretYaw) * 2.2,
        });
        // hitscan along the aim: first soft unit within range and a narrow cone
        let best: UnitState | null = null;
        let bestD = w.range;
        for (const t of gs.units) {
          if (!t.alive || t.side === u.side) continue;
          const d = dist2D(u.x, u.z, t.x, t.z);
          if (d > bestD || d < 4) continue;
          const bearing = Math.atan2(t.z - u.z, t.x - u.x);
          if (Math.abs(angleDelta(this.aimYaw, bearing)) > 0.09 + ARCHETYPES[t.cls].radius / d) continue;
          best = t;
          bestD = d;
        }
        if (best) {
          const ta = ARCHETYPES[best.cls];
          if (ta.kind !== 'vehicle') {
            let hits = 0;
            for (let r = 0; r < w.burst; r++) if (gs.rng.chance(0.4 * (1 - 0.45 * best.inCoverQuality))) hits++;
            if (hits > 0) combat.applyDamage(gs, best, hits * w.damage * gs.tuning.playerDamage, w, u, 'bullet');
            Suppression.apply(gs, best, w.suppression);
          }
          gs.bus.emit('combat:hit', {
            targetId: best.id,
            damage: 0,
            kind: 'bullets',
            x: best.x,
            y: best.y + 1.2,
            z: best.z,
          });
        }
      }
    }
  }
}
