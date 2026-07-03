/**
 * Combat system: target acquisition, turret/hull aiming, fire control,
 * shell projectile simulation with armor-facing penetration and ricochet,
 * hitscan small-arms bursts, HE blasts, suppression delivery, critical
 * states (mobility/turret/burning), destruction and persistent wrecks.
 *
 * Every shot, hit and kill flows through the EventBus for FX/audio, and
 * increments the GameState counters the verification battery asserts.
 */

import type { GameState } from './GameState.ts';
import { ARCHETYPES, type UnitState, type WeaponSpec } from './Types.ts';
import { Suppression } from './Suppression.ts';
import { Spotting } from './Spotting.ts';
import { angleDelta, clamp01, turnToward, dist2D } from '../core/MathUtil.ts';
import { NAV_N, NavGrid, F_BUILDING, F_WALL, F_HEDGE, F_RUIN, F_WRECK } from '../nav/NavGrid.ts';

export interface Projectile {
  id: number;
  shooterId: number;
  side: 'player' | 'enemy';
  weapon: WeaponSpec;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** Aimed at unit (for guidance-free hit crediting only). */
  targetId: number;
  life: number;
  gravity: boolean;
}

const TARGET_SCAN_PERIOD = 0.45;
const COVER_SCAN_PERIOD = 0.9;

export class Combat {
  readonly name = 'combat';
  readonly projectiles: Projectile[] = [];
  private nextProjectileId = 1;
  private spotter = new Spotting();
  private scanAcc = 0;
  private coverAcc = 0;

  tick(gs: GameState, dt: number): void {
    this.scanAcc += dt;
    const scan = this.scanAcc >= TARGET_SCAN_PERIOD;
    if (scan) this.scanAcc -= TARGET_SCAN_PERIOD;
    this.coverAcc += dt;
    const coverScan = this.coverAcc >= COVER_SCAN_PERIOD;
    if (coverScan) this.coverAcc -= COVER_SCAN_PERIOD;

    for (const u of gs.units) {
      if (!u.alive) continue;
      if (coverScan) this.updateCover(gs, u);
      if (scan) this.acquireTarget(gs, u);
      this.aimAndFire(gs, u, dt);
      this.tickBurning(gs, u, dt);
    }

    this.integrateProjectiles(gs, dt);
    gs.projectilesLive = this.projectiles.length;
  }

  // ------------------------------------------------------------- targeting

  private targetPriority(shooter: UnitState, target: UnitState): number {
    const sa = ARCHETYPES[shooter.cls];
    const ta = ARCHETYPES[target.cls];
    let p = 0;
    const targetIsArmor = ta.kind === 'vehicle';
    if (shooter.cls === 'at-gun') p = targetIsArmor ? 100 : 5;
    else if (shooter.cls === 'mg-team') p = targetIsArmor ? 4 : 80;
    else if (sa.kind === 'vehicle') p = targetIsArmor ? 90 : target.cls === 'at-gun' ? 85 : 55;
    else p = targetIsArmor ? (sa.weapons.some((w) => w.kind === 'grenade') ? 25 : 8) : 60;
    // prefer closer targets
    const d = dist2D(shooter.x, shooter.z, target.x, target.z);
    return p - d * 0.08;
  }

  private canEngage(_shooter: UnitState, target: UnitState, w: WeaponSpec): boolean {
    const ta = ARCHETYPES[target.cls];
    if (ta.kind === 'vehicle' && w.penetration < 12 && w.blastRadius === 0) return false; // rifles can't hurt tanks
    return true;
  }

  private acquireTarget(gs: GameState, u: UnitState): void {
    // explicit attack-target order pins the target while it lives & is visible
    if (u.order.type === 'attack-target') {
      const t = gs.byId.get(u.order.targetId);
      if (t && t.alive && this.spotter.canSee(gs, u, t)) {
        u.targetId = t.id;
        return;
      }
    }
    if (u.order.type === 'hold' || true) {
      // auto-acquire: best visible enemy in weapon range
      const arch = ARCHETYPES[u.cls];
      const maxRange = Math.max(...arch.weapons.map((w) => w.range));
      let best: UnitState | null = null;
      let bestP = -Infinity;
      for (const t of gs.units) {
        if (t.side === u.side || !t.alive) continue;
        const d = dist2D(u.x, u.z, t.x, t.z);
        if (d > maxRange) continue;
        if (!arch.weapons.some((w) => d <= w.range && this.canEngage(u, t, w))) continue;
        if (!this.spotter.canSee(gs, u, t)) continue;
        const p = this.targetPriority(u, t);
        if (p > bestP) {
          bestP = p;
          best = t;
        }
      }
      const current = gs.byId.get(u.targetId);
      const keepCurrent =
        current &&
        current.alive &&
        current.side !== u.side &&
        dist2D(u.x, u.z, current.x, current.z) < maxRange * 1.05 &&
        this.spotter.canSee(gs, u, current);
      if (best && (!keepCurrent || this.targetPriority(u, best) > this.targetPriority(u, current) + 15)) {
        u.targetId = best.id;
      } else if (!keepCurrent) {
        u.targetId = best ? best.id : -1;
      }
    }
  }

  // ---------------------------------------------------------- aim and fire

  private aimAndFire(gs: GameState, u: UnitState, dt: number): void {
    const arch = ARCHETYPES[u.cls];
    const target = gs.byId.get(u.targetId);

    // cooldowns always advance
    for (const ws of u.weapons) {
      if (ws.cooldown > 0) ws.cooldown -= dt;
      ws.reloadLeft = Math.max(0, ws.cooldown);
    }

    if (!target || !target.alive || target.side === u.side) {
      u.targetId = -1;
      // attack-ground: shell a map point on demand (HE prep fire)
      if (u.order.type === 'attack-ground' && !u.directControl) {
        this.attackGround(gs, u, dt);
        return;
      }
      // turret returns to hull facing
      if (arch.turretRate > 0 && !u.directControl) {
        u.turretYaw = turnToward(u.turretYaw, u.yaw, arch.turretRate * 0.5 * dt);
      }
      return;
    }

    const dx = target.x - u.x;
    const dz = target.z - u.z;
    const dist = Math.hypot(dx, dz);
    const wantYaw = Math.atan2(dz, dx);

    // aim: turret traverse or hull/gun-arc alignment
    let aimed = false;
    if (arch.turretRate > 0) {
      if (!u.crits.turret) {
        u.turretYaw = turnToward(u.turretYaw, wantYaw, arch.turretRate * dt);
      }
      aimed = Math.abs(angleDelta(u.turretYaw, wantYaw)) < 0.045;
    } else {
      // casemate / emplaced gun: rotate mount (guns) or hull (StuG stationary)
      const rate = arch.kind === 'gun' ? arch.turretRate || arch.turnRate : arch.turnRate;
      if (u.vel < 0.5) {
        if (arch.kind === 'gun') {
          u.turretYaw = turnToward(u.turretYaw, wantYaw, (rate || 0.5) * dt);
          u.yaw = u.turretYaw;
        } else {
          u.yaw = turnToward(u.yaw, wantYaw, rate * dt);
          u.turretYaw = u.yaw;
        }
      }
      aimed = Math.abs(angleDelta(u.turretYaw, wantYaw)) < 0.05;
    }

    if (!aimed || u.directControl) return;

    for (let wi = 0; wi < arch.weapons.length; wi++) {
      const w = arch.weapons[wi];
      const ws = u.weapons[wi];
      if (!w || !ws || ws.cooldown > 0) continue;
      if (dist > w.range) continue;
      if (!this.canEngage(u, target, w)) continue;
      // pinned troops still get sporadic, wild return fire
      if (u.pinned && !gs.rng.chance(0.35)) {
        ws.cooldown = w.reload * 0.6;
        continue;
      }
      this.fireWeapon(gs, u, target, w, ws, dist);
    }
  }

  /** Shell a designated ground point (no target needed — area fire). */
  private attackGround(gs: GameState, u: UnitState, dt: number): void {
    const arch = ARCHETYPES[u.cls];
    const wi = arch.weapons.findIndex((w) => w.blastRadius > 0 && w.kind === 'cannon');
    if (wi < 0) return; // only gun-armed units shell the ground
    const w = arch.weapons[wi];
    const ws = u.weapons[wi];
    if (!w || !ws) return;
    const dx = u.order.x - u.x;
    const dz = u.order.z - u.z;
    const dist = Math.hypot(dx, dz);
    if (dist > w.range || dist < 8) return;
    const wantYaw = Math.atan2(dz, dx);
    if (arch.turretRate > 0) {
      if (!u.crits.turret) u.turretYaw = turnToward(u.turretYaw, wantYaw, arch.turretRate * dt);
    } else if (u.vel < 0.5) {
      u.yaw = turnToward(u.yaw, wantYaw, arch.turnRate * dt);
      u.turretYaw = u.yaw;
    }
    if (Math.abs(angleDelta(u.turretYaw, wantYaw)) > 0.05 || ws.cooldown > 0 || u.pinned) return;

    ws.cooldown = w.reload * gs.rng.range(0.95, 1.1);
    if (u.side === 'player') gs.shotsByPlayer++;
    else gs.shotsByEnemy++;
    gs.projectilesFired++;
    gs.audioEvents++;
    const mh = this.muzzleHeight(u);
    gs.bus.emit('combat:shot', {
      shooterId: u.id,
      side: u.side,
      weapon: 'cannon',
      x: u.x + Math.cos(u.turretYaw) * 2.2,
      y: u.y + mh,
      z: u.z + Math.sin(u.turretYaw) * 2.2,
    });
    const scatter = 3.5;
    const ax = u.order.x + gs.rng.range(-scatter, scatter);
    const az = u.order.z + gs.rng.range(-scatter, scatter);
    const ddx = ax - u.x;
    const ddz = az - u.z;
    const dd = Math.hypot(ddx, ddz);
    const speed = w.projectileSpeed;
    const sy = u.y + mh;
    const ty = gs.ground.height(ax, az) + 0.4;
    this.projectiles.push({
      id: this.nextProjectileId++,
      shooterId: u.id,
      side: u.side,
      weapon: w,
      x: u.x + (ddx / dd) * 2.4,
      y: sy,
      z: u.z + (ddz / dd) * 2.4,
      vx: (ddx / dd) * speed,
      vy: (ty - sy) / (dd / speed),
      vz: (ddz / dd) * speed,
      targetId: -1,
      life: dd / speed + 3,
      gravity: false,
    });
  }

  private muzzleHeight(u: UnitState): number {
    const arch = ARCHETYPES[u.cls];
    return arch.kind === 'vehicle' ? 2.3 : arch.cls === 'at-gun' ? 1.0 : 1.35;
  }

  private fireWeapon(gs: GameState, u: UnitState, target: UnitState, w: WeaponSpec, ws: { cooldown: number }, dist: number): void {
    const tuning = gs.tuning;
    const accMult = (u.side === 'enemy' ? tuning.enemyAccuracy : 1) * (1 - 0.4 * clamp01(u.suppression));
    ws.cooldown = w.reload * gs.rng.range(0.92, 1.12);
    if (u.side === 'player') gs.shotsByPlayer++;
    else gs.shotsByEnemy++;

    // muzzle flash reveals the shooter to the other side for a few seconds
    if (u.side === 'enemy') {
      u.spotted = true;
      u.spotLinger = Math.max(u.spotLinger, 3.0);
    }

    const mh = this.muzzleHeight(u);
    gs.bus.emit('combat:shot', {
      shooterId: u.id,
      side: u.side,
      weapon: w.kind,
      x: u.x + Math.cos(u.turretYaw) * 2.2,
      y: u.y + mh,
      z: u.z + Math.sin(u.turretYaw) * 2.2,
    });
    gs.audioEvents++;

    if (w.kind === 'cannon' || w.kind === 'grenade') {
      // real projectile
      const speed = w.projectileSpeed;
      const th = ARCHETYPES[target.cls].kind === 'vehicle' ? 1.4 : 0.9;
      const ty = target.y + th;
      const sy = u.y + mh;
      // accuracy: aim error grows with range
      const rangeFrac = clamp01(dist / w.range);
      const acc = clamp01(w.accuracy * accMult * (1.25 - rangeFrac * 0.65) * (ARCHETYPES[target.cls].kind === 'vehicle' ? 1.3 : 1));
      const hitRoll = gs.rng.chance(acc * (1 - 0.4 * clamp01(target.inCoverQuality)) * (target.vel > 1.5 ? 0.85 : 1));
      let aimX = target.x;
      let aimZ = target.z;
      let aimY = ty;
      if (!hitRoll) {
        const missR = 2.2 + rangeFrac * 7;
        aimX += gs.rng.range(-missR, missR);
        aimZ += gs.rng.range(-missR, missR);
        aimY = ty + gs.rng.range(-0.8, 1.4);
      }
      const ddx = aimX - u.x;
      const ddz = aimZ - u.z;
      const dd = Math.hypot(ddx, ddz);
      const flightT = dd / speed;
      const grav = w.kind === 'grenade';
      const vy = grav ? (aimY - sy) / flightT + 4.9 * flightT : (aimY - sy) / flightT;
      this.projectiles.push({
        id: this.nextProjectileId++,
        shooterId: u.id,
        side: u.side,
        weapon: w,
        x: u.x + (ddx / dd) * 2.4,
        y: sy,
        z: u.z + (ddz / dd) * 2.4,
        vx: (ddx / dd) * speed,
        vy,
        vz: (ddz / dd) * speed,
        targetId: target.id,
        life: flightT + 3,
        gravity: grav,
      });
      if (w.kind === 'cannon') gs.projectilesFired++;
    } else {
      // hitscan burst (MG/rifle)
      const rangeFrac = clamp01(dist / w.range);
      const perRound = clamp01(w.accuracy * accMult * (1.15 - rangeFrac * 0.55)) * (1 - 0.45 * clamp01(target.inCoverQuality));
      let hits = 0;
      for (let r = 0; r < w.burst; r++) if (gs.rng.chance(perRound * 0.42)) hits++;
      const dmgScale = u.side === 'enemy' ? gs.tuning.enemyDamage : gs.tuning.playerDamage;
      if (hits > 0) {
        this.applyDamage(gs, target, hits * w.damage * dmgScale, w, u, 'bullet');
      }
      // suppression lands regardless of hits
      Suppression.apply(gs, target, w.suppression * (0.5 + perRound * 0.6));
      gs.bus.emit('combat:hit', {
        targetId: target.id,
        damage: hits * w.damage,
        kind: hits > 0 ? 'bullets' : 'near-miss',
        x: target.x + gs.rng.range(-1, 1),
        y: target.y + 1,
        z: target.z + gs.rng.range(-1, 1),
      });
    }
  }

  // ------------------------------------------------------------ projectiles

  private integrateProjectiles(gs: GameState, dt: number): void {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      if (!p) continue;
      p.life -= dt;
      if (p.life <= 0) {
        this.projectiles.splice(i, 1);
        continue;
      }
      // substep for collision robustness
      const steps = Math.max(1, Math.ceil((Math.hypot(p.vx, p.vy, p.vz) * dt) / 1.8));
      let removed = false;
      for (let s = 0; s < steps && !removed; s++) {
        const sdt = dt / steps;
        if (p.gravity) p.vy -= 9.8 * sdt;
        p.x += p.vx * sdt;
        p.y += p.vy * sdt;
        p.z += p.vz * sdt;
        removed = this.collideProjectile(gs, p);
      }
      if (removed) {
        const idx = this.projectiles.indexOf(p);
        if (idx >= 0) this.projectiles.splice(idx, 1);
      }
    }
  }

  private collideProjectile(gs: GameState, p: Projectile): boolean {
    // terrain
    const groundY = gs.ground.height(p.x, p.z);
    if (p.y <= groundY + 0.05) {
      this.explodeAt(gs, p, p.x, groundY, p.z, null);
      return true;
    }

    // units
    for (const t of gs.units) {
      if (!t.alive || t.side === p.side) continue;
      const ta = ARCHETYPES[t.cls];
      const rr = ta.radius + 0.3;
      const dx = p.x - t.x;
      const dz = p.z - t.z;
      if (dx * dx + dz * dz > rr * rr) continue;
      const height = ta.kind === 'vehicle' ? 2.9 : 1.9;
      if (p.y < t.y || p.y > t.y + height) continue;
      this.hitUnit(gs, p, t);
      return true;
    }

    // static blockers: buildings/walls/hedges/wrecks via nav grid heights
    const cx = NavGrid.toCell(p.x);
    const cz = NavGrid.toCell(p.z);
    if (NavGrid.inBounds(cx, cz)) {
      const idx = cz * NAV_N + cx;
      const f = gs.nav.flags[idx] ?? 0;
      if (f & (F_BUILDING | F_WALL | F_HEDGE | F_RUIN | F_WRECK)) {
        const blockH = gs.nav.sightHeight[idx] ?? 0;
        if (blockH > 0 && p.y < groundY + blockH) {
          this.explodeAt(gs, p, p.x, p.y, p.z, idx);
          return true;
        }
      }
    }
    return false;
  }

  private hitUnit(gs: GameState, p: Projectile, t: UnitState): void {
    const w = p.weapon;
    const ta = ARCHETYPES[t.cls];
    const dmgScale = p.side === 'enemy' ? gs.tuning.enemyDamage : gs.tuning.playerDamage;
    gs.projectileHits++;

    if (ta.kind === 'vehicle' && w.penetration > 10) {
      // armor facing
      const impactDir = Math.atan2(-p.vz, -p.vx); // direction the shell came FROM, relative to hull
      const rel = Math.abs(angleDelta(t.yaw, impactDir));
      const facing = rel < Math.PI / 3 ? 'front' : rel < (2 * Math.PI) / 3 ? 'side' : 'rear';
      const armor = ta.armor[facing];
      const shooter = gs.byId.get(p.shooterId);
      const dist = shooter ? dist2D(shooter.x, shooter.z, t.x, t.z) : 100;
      const rangeFrac = clamp01(dist / w.range);
      const effPen = w.penetration * (1 - (1 - w.penFalloff) * rangeFrac) * gs.rng.range(0.85, 1.15);
      // grazing ricochet chance on non-frontal geometry
      const grazing = facing === 'front' && rel > Math.PI / 4;
      if (effPen > armor && !(grazing && gs.rng.chance(0.25))) {
        // penetration
        const dmg = w.damage * gs.rng.range(0.8, 1.25) * dmgScale;
        gs.bus.emit('combat:penetrated', { targetId: t.id, x: p.x, y: p.y, z: p.z });
        this.applyDamage(gs, t, dmg, w, gs.byId.get(p.shooterId) ?? null, 'ap');
        // crits
        if (t.alive) {
          if (gs.rng.chance(0.22)) t.crits.mobility = true;
          if (gs.rng.chance(0.16)) t.crits.turret = true;
          if (gs.rng.chance(0.14)) {
            t.crits.burning = true;
            t.crits.burnTime = 7;
          }
        }
      } else {
        // bounce
        gs.bus.emit('combat:ricochet', { targetId: t.id, x: p.x, y: p.y, z: p.z });
        this.applyDamage(gs, t, 2.5 * dmgScale, w, null, 'spall');
      }
      gs.audioEvents++;
    } else {
      // direct hit on soft target
      this.applyDamage(gs, t, w.damage * 1.6 * dmgScale, w, gs.byId.get(p.shooterId) ?? null, 'he-direct');
    }

    // HE burst on impact regardless
    if (w.blastRadius > 0) this.blast(gs, p.x, p.y, p.z, w, p.side, t.id);
    gs.bus.emit('combat:hit', { targetId: t.id, damage: w.damage, kind: 'shell', x: p.x, y: p.y, z: p.z });
  }

  private explodeAt(gs: GameState, p: Projectile, x: number, y: number, z: number, blockIdx: number | null): void {
    const w = p.weapon;
    if (w.blastRadius > 0) {
      this.blast(gs, x, y, z, w, p.side, -1);
      // breach cover: HE opens walls/hedges
      if (w.kind === 'cannon') {
        gs.nav.breach(x, z, Math.max(1.6, w.blastRadius * 0.4));
      }
    }
    gs.bus.emit('combat:explosion', {
      x,
      y,
      z,
      radius: Math.max(1.2, w.blastRadius),
      kind: blockIdx !== null ? 'structure' : 'ground',
    });
    gs.audioEvents++;
  }

  private blast(gs: GameState, x: number, _y: number, z: number, w: WeaponSpec, side: 'player' | 'enemy', directHitId: number): void {
    const dmgScale = side === 'enemy' ? gs.tuning.enemyDamage : gs.tuning.playerDamage;
    for (const t of gs.units) {
      if (!t.alive) continue;
      // friendly fire for blasts is real but reduced (danger close)
      const friendly = t.side === side;
      if (t.id === directHitId) continue;
      const d = dist2D(x, z, t.x, t.z);
      if (d > w.blastRadius + ARCHETYPES[t.cls].radius) continue;
      const falloff = clamp01(1 - d / (w.blastRadius + 0.5));
      const ta = ARCHETYPES[t.cls];
      let dmg = w.blastDamage * falloff * dmgScale * (friendly ? 0.35 : 1);
      if (ta.kind === 'vehicle') dmg *= 0.25; // armor shrugs HE except near-direct
      const cover = clamp01(t.inCoverQuality);
      dmg *= 1 - cover * 0.5;
      if (dmg > 1) this.applyDamage(gs, t, dmg, w, null, 'blast');
      if (!friendly) Suppression.apply(gs, t, w.suppression * falloff);
    }
  }

  // ---------------------------------------------------------------- damage

  applyDamage(gs: GameState, t: UnitState, amount: number, w: WeaponSpec | null, shooter: UnitState | null, kind: string): void {
    if (!t.alive) return;
    t.hp -= amount;
    const ta = ARCHETYPES[t.cls];

    // infantry: soldiers drop as hp falls
    if (ta.soldiers > 0) {
      const perMan = ta.maxHp / ta.soldiers;
      const shouldBeAlive = Math.max(0, Math.ceil(t.hp / perMan));
      let aliveNow = t.soldiers.filter((s) => s.alive).length;
      let guard = 12;
      while (aliveNow > shouldBeAlive && guard-- > 0) {
        // deterministic pick: first living soldier from rotating index
        const start = (t.id + Math.floor(gs.missionTime * 7)) % t.soldiers.length;
        for (let k = 0; k < t.soldiers.length; k++) {
          const s = t.soldiers[(start + k) % t.soldiers.length];
          if (s && s.alive) {
            s.alive = false;
            break;
          }
        }
        aliveNow--;
      }
    }

    if (t.hp <= 0) this.destroy(gs, t, shooter, kind);
    void w;
  }

  private tickBurning(gs: GameState, u: UnitState, dt: number): void {
    if (!u.crits.burning || !u.alive) return;
    u.crits.burnTime -= dt;
    this.applyDamage(gs, u, 4.2 * dt, null, null, 'fire');
    if (u.crits.burnTime <= 0) u.crits.burning = false;
  }

  private destroy(gs: GameState, t: UnitState, shooter: UnitState | null, kind: string): void {
    t.alive = false;
    t.hp = 0;
    t.path = null;
    t.targetId = -1;
    gs.unitsDestroyed++;
    const ta = ARCHETYPES[t.cls];
    if (ta.kind === 'vehicle') {
      t.isWreck = true;
      gs.nav.addWreck(t.x, t.z, ta.radius + 0.6);
      gs.bus.emit('combat:explosion', { x: t.x, y: t.y + 1.4, z: t.z, radius: 4.5, kind: 'vehicle' });
    }
    gs.bus.emit('unit:destroyed', {
      unitId: t.id,
      side: t.side,
      type: t.cls,
      x: t.x,
      y: t.y,
      z: t.z,
    });
    gs.audioEvents++;

    // loss condition: all player units dead
    if (t.side === 'player' && gs.aliveOf('player') === 0) {
      gs.lose('All units lost — the attack has failed.');
    }
    void shooter;
    void kind;
  }

  // ----------------------------------------------------------------- cover

  private updateCover(gs: GameState, u: UnitState): void {
    const arch = ARCHETYPES[u.cls];
    if (arch.kind === 'vehicle') {
      u.inCoverQuality = 0;
      return;
    }
    if (arch.kind === 'gun') {
      // emplaced weapons fight from sandbagged positions
      u.inCoverQuality = Math.max(u.inCoverQuality, 0.7);
    }
    // sample nav flags in a small ring around the unit
    let best = 0;
    const cx = NavGrid.toCell(u.x);
    const cz = NavGrid.toCell(u.z);
    for (let dz = -2; dz <= 2; dz++) {
      for (let dx = -2; dx <= 2; dx++) {
        if (!NavGrid.inBounds(cx + dx, cz + dz)) continue;
        const f = gs.nav.flags[(cz + dz) * NAV_N + (cx + dx)] ?? 0;
        if (f & F_BUILDING) best = Math.max(best, 0.75);
        else if (f & F_WALL) best = Math.max(best, 0.65);
        else if (f & F_HEDGE) best = Math.max(best, 0.55);
        else if (f & (F_RUIN | F_WRECK)) best = Math.max(best, 0.6);
      }
    }
    // craters give partial cover
    if (gs.ground.craterMask(u.x, u.z) > 0.4) best = Math.max(best, 0.35);
    u.inCoverQuality = best;
  }
}
