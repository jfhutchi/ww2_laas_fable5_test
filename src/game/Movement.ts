/**
 * Movement system: path following with vehicle kinematics (hull turn-rate
 * limited, acceleration, terrain slowdown) and infantry squad flow (soldiers
 * flock around the squad centroid in a heading-aligned formation).
 * Separation steering keeps units from stacking.
 */

import type { UnitState } from './Types.ts';
import { ARCHETYPES } from './Types.ts';
import type { Ground } from '../world/Ground.ts';
import { NavGrid } from '../nav/NavGrid.ts';
import { angleDelta, clamp, turnToward } from '../core/MathUtil.ts';

const ARRIVE_DIST = 2.2;
const WAYPOINT_DIST = 2.8;

export class Movement {
  constructor(
    private ground: Ground,
    private nav: NavGrid,
  ) {}

  tick(units: UnitState[], dt: number): void {
    for (const u of units) {
      if (!u.alive) continue;
      if (u.directControl) continue; // DirectControl system drives it
      this.moveUnit(u, units, dt);
      this.settleToGround(u);
      if (ARCHETYPES[u.cls].kind === 'infantry') this.flowSoldiers(u, dt);
    }
  }

  private moveUnit(u: UnitState, all: UnitState[], dt: number): void {
    const arch = ARCHETYPES[u.cls];
    const isVehicle = arch.kind === 'vehicle';

    // current waypoint
    let goalX: number | null = null;
    let goalZ: number | null = null;
    if (u.path && u.pathIndex < u.path.length) {
      const wp = u.path[u.pathIndex];
      if (wp) {
        goalX = wp.x;
        goalZ = wp.z;
        const d = Math.hypot(wp.x - u.x, wp.z - u.z);
        const last = u.pathIndex === u.path.length - 1;
        if (d < (last ? ARRIVE_DIST : WAYPOINT_DIST)) {
          u.pathIndex++;
          if (u.pathIndex >= u.path.length) {
            u.path = null;
            // only complete the order if we truly reached it — partial paths
            // (A* expansion cap on long routes) trigger a re-path instead
            const remaining = Math.hypot(u.order.x - u.x, u.order.z - u.z);
            if (u.order.type === 'move' && remaining < 5) {
              u.order = { ...u.order, type: 'idle' };
            }
          }
        }
      }
    }

    // guns are emplaced: they rotate but don't travel unless ordered (slow crawl)
    let maxSpeed = arch.speed;
    if (u.crits.mobility) maxSpeed *= 0.35;
    if (u.pinned) maxSpeed *= arch.kind === 'infantry' ? 0.35 : 1;
    else if (u.suppression > 0.5) maxSpeed *= arch.kind === 'infantry' ? 0.6 : 1;

    if (goalX === null || goalZ === null) {
      // decelerate
      u.vel = Math.max(0, u.vel - arch.speed * 2.4 * dt);
      if (u.vel > 0.01) this.integrate(u, dt, isVehicle);
      return;
    }

    const desiredYaw = Math.atan2(goalZ - u.z, goalX - u.x);
    const dYaw = Math.abs(angleDelta(u.yaw, desiredYaw));

    if (isVehicle) {
      // hull must swing toward the waypoint; sharp angles brake first
      u.yaw = turnToward(u.yaw, desiredYaw, arch.turnRate * dt * (u.vel < 0.5 ? 1.35 : 1));
      const align = clamp(1.15 - dYaw * 1.35, 0, 1);
      const target = maxSpeed * align;
      const accel = target > u.vel ? maxSpeed * 0.55 : maxSpeed * 2.2;
      u.vel += clamp(target - u.vel, -accel * dt, accel * dt);
    } else {
      u.yaw = turnToward(u.yaw, desiredYaw, arch.turnRate * dt);
      const target = dYaw > 2.1 ? 0 : maxSpeed;
      u.vel += clamp(target - u.vel, -maxSpeed * 6 * dt, maxSpeed * 4 * dt);
    }

    // separation from nearby units
    let pushX = 0;
    let pushZ = 0;
    for (const o of all) {
      if (o === u || (!o.alive && !o.isWreck)) continue;
      const minDist = arch.radius + ARCHETYPES[o.cls].radius + 0.6;
      const dx = u.x - o.x;
      const dz = u.z - o.z;
      const dSq = dx * dx + dz * dz;
      if (dSq > minDist * minDist || dSq < 1e-6) continue;
      const d = Math.sqrt(dSq);
      const f = (minDist - d) / minDist;
      pushX += (dx / d) * f * 3;
      pushZ += (dz / d) * f * 3;
    }

    this.integrate(u, dt, isVehicle, pushX, pushZ);
  }

  private integrate(u: UnitState, dt: number, isVehicle: boolean, pushX = 0, pushZ = 0): void {
    const stepX = Math.cos(u.yaw) * u.vel * dt + pushX * dt;
    const stepZ = Math.sin(u.yaw) * u.vel * dt + pushZ * dt;
    const nx = u.x + stepX;
    const nz = u.z + stepZ;
    // hard collision: refuse to enter impassable cells
    const pass = (x: number, z: number): boolean => {
      const cx = NavGrid.toCell(x);
      const cz = NavGrid.toCell(z);
      return isVehicle ? this.nav.vehiclePassable(cx, cz) : this.nav.infantryPassable(cx, cz);
    };
    if (pass(nx, nz)) {
      u.x = nx;
      u.z = nz;
    } else {
      // slide along the unblocked axis
      if (pass(u.x + stepX, u.z)) u.x += stepX;
      else if (pass(u.x, u.z + stepZ)) u.z += stepZ;
      else u.vel *= 0.4;
      u.repathCooldown = Math.min(u.repathCooldown, 0.25); // ask for a fresh path soon
    }
  }

  private settleToGround(u: UnitState): void {
    u.y = this.ground.height(u.x, u.z);
  }

  private flowSoldiers(u: UnitState, dt: number): void {
    // formation axes: dx = lateral (left/right of heading), dz = ranks behind
    const fwdX = Math.cos(u.yaw);
    const fwdZ = Math.sin(u.yaw);
    const latX = -fwdZ;
    const latZ = fwdX;
    const moving = u.vel > 0.2;
    for (const s of u.soldiers) {
      if (!s.alive) continue;
      const tx = u.x + latX * s.dx - fwdX * s.dz;
      const tz = u.z + latZ * s.dx - fwdZ * s.dz;
      const rate = moving ? 3.2 : 1.6;
      s.x += (tx - s.x) * clamp(rate * dt, 0, 1);
      s.z += (tz - s.z) * clamp(rate * dt, 0, 1);
    }
  }
}
