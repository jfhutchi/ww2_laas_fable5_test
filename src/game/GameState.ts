/**
 * GameState: owns all units and runs the fixed-step simulation systems in a
 * deterministic order. Constructed when a mission starts; publishes real
 * counters for the HUD, debug HUD and verification battery.
 */

import type { WorldModel } from '../world/WorldTypes.ts';
import type { Ground } from '../world/Ground.ts';
import type { Difficulty } from '../app/Config.ts';
import type { OcGameStats } from '../app/Hooks.ts';
import { EventBus } from '../core/EventBus.ts';
import { Rng, rootRng } from '../core/Random.ts';
import { NavGrid } from '../nav/NavGrid.ts';
import { findPath, snapToPassable } from '../nav/Pathfinding.ts';
import { LineOfSight } from './LineOfSight.ts';
import { Movement } from './Movement.ts';
import { ARCHETYPES, makeUnit, type Order, type Side, type UnitClass, type UnitState } from './Types.ts';

export type MissionState = 'running' | 'won' | 'lost';

export interface DifficultyTuning {
  enemyAccuracy: number;
  enemyReactionS: number;
  enemyDamage: number;
  reinforcementDelayS: number;
  missionTimerS: number | null;
  playerDamage: number;
}

const TUNING: Record<Difficulty, DifficultyTuning> = {
  easy: {
    enemyAccuracy: 0.72,
    enemyReactionS: 1.7,
    enemyDamage: 0.78,
    reinforcementDelayS: 24,
    missionTimerS: null,
    playerDamage: 1.15,
  },
  normal: {
    enemyAccuracy: 1,
    enemyReactionS: 1.0,
    enemyDamage: 1,
    reinforcementDelayS: 12,
    missionTimerS: null,
    playerDamage: 1,
  },
  hard: {
    enemyAccuracy: 1.2,
    enemyReactionS: 0.55,
    enemyDamage: 1.18,
    reinforcementDelayS: 5,
    missionTimerS: 25 * 60,
    playerDamage: 0.92,
  },
};

export class GameState {
  readonly units: UnitState[] = [];
  readonly byId = new Map<number, UnitState>();
  readonly nav: NavGrid;
  readonly los: LineOfSight;
  readonly movement: Movement;
  readonly rng: Rng;
  readonly tuning: DifficultyTuning;

  missionState: MissionState = 'running';
  missionTime = 0;
  lossReason = '';
  reinforcementsTriggered = false;

  // battery/HUD counters — all incremented by real events
  projectilesFired = 0;
  projectileHits = 0;
  unitsDestroyed = 0;
  shotsByPlayer = 0;
  shotsByEnemy = 0;
  audioEvents = 0;

  private nextUnitId = 1;
  private pathBudget = 0;
  private pathQueue: UnitState[] = [];

  constructor(
    readonly model: WorldModel,
    readonly ground: Ground,
    readonly bus: EventBus,
    readonly difficulty: Difficulty,
  ) {
    this.tuning = TUNING[difficulty];
    this.rng = rootRng(model.seed).fork('sim');
    this.nav = new NavGrid(model, ground);
    this.los = new LineOfSight(this.nav, ground);
    this.movement = new Movement(ground, this.nav);
    this.spawnMission();
  }

  // ---------------------------------------------------------------- spawn

  private spawn(side: Side, cls: UnitClass, callsign: string, x: number, z: number, yaw: number): UnitState {
    const vehicle = ARCHETYPES[cls].kind !== 'infantry';
    const snapped = snapToPassable(this.nav, x, z, vehicle);
    const u = makeUnit(this.nextUnitId++, side, cls, callsign, snapped.x, snapped.z, yaw);
    u.homeX = snapped.x;
    u.homeZ = snapped.z;
    u.y = this.ground.height(snapped.x, snapped.z);
    this.units.push(u);
    this.byId.set(u.id, u);
    return u;
  }

  private spawnMission(): void {
    const m = this.model;
    const ps = m.playerSpawn;
    const fwd = ps.facing;
    const latX = -Math.sin(fwd);
    const latZ = Math.cos(fwd);
    const bakX = -Math.cos(fwd);
    const bakZ = -Math.sin(fwd);

    // player force: 3 Shermans in column on the road, infantry flanking
    for (let i = 0; i < 3; i++) {
      this.spawn('player', 'sherman', `${i + 1}`, ps.x + bakX * i * 14, ps.z + bakZ * i * 14, fwd);
    }
    for (let i = 0; i < 3; i++) {
      const sideSign = i % 2 === 0 ? 1 : -1;
      this.spawn(
        'player',
        'rifle-squad',
        `${i + 4}`,
        ps.x + latX * sideSign * (10 + i * 3) + bakX * (6 + i * 10),
        ps.z + latZ * sideSign * (10 + i * 3) + bakZ * (6 + i * 10),
        fwd,
      );
    }
    for (let i = 0; i < 2; i++) {
      const sideSign = i === 0 ? 1 : -1;
      this.spawn(
        'player',
        'scout-team',
        `${i + 7}`,
        ps.x + latX * sideSign * 16 - bakX * 12,
        ps.z + latZ * sideSign * 16 - bakZ * 12,
        fwd,
      );
    }

    // enemy defenders — emplaced weapons get a prepared firing slot cut
    // through their own cover (a real gun position, not a blind nest)
    const clearFireLane = (x: number, z: number, facing: number): void => {
      for (const d of [3.5, 7, 10.5, 14]) {
        this.nav.breach(x + Math.cos(facing) * d, z + Math.sin(facing) * d, 2.4);
      }
    };
    const a = m.enemyAnchors;
    const at = this.spawn('enemy', 'at-gun', 'AT1', a.atGun.x, a.atGun.z, a.atGun.facing);
    at.aiRole = 'at';
    clearFireLane(at.x, at.z, a.atGun.facing);
    a.mgNests.forEach((n, i) => {
      const mg = this.spawn('enemy', 'mg-team', `MG${i + 1}`, n.x, n.z, n.facing);
      mg.aiRole = 'mg';
      clearFireLane(mg.x, mg.z, n.facing);
    });
    const infN = Math.min(5, a.infantry.length);
    for (let i = 0; i < infN; i++) {
      const n = a.infantry[i];
      if (!n) continue;
      const g = this.spawn('enemy', 'grenadier-squad', `G${i + 1}`, n.x, n.z, n.facing);
      g.aiRole = 'infantry';
    }
    const armor = this.spawn('enemy', 'stug', 'ST1', a.armor.x, a.armor.z, a.armor.facing);
    armor.aiRole = 'armor';
  }

  /** Called by CaptureSystem when player progress crosses 50%. */
  spawnReinforcements(): void {
    if (this.reinforcementsTriggered) return;
    this.reinforcementsTriggered = true;
    const e = this.model.enemyAnchors.reinforcementsEntry;
    const lat = e.facing + Math.PI / 2;
    for (let i = 0; i < 2; i++) {
      const t = this.spawn(
        'enemy',
        'panzer4',
        `PZ${i + 1}`,
        e.x + Math.cos(lat) * (i * 12 - 6),
        e.z + Math.sin(lat) * (i * 12 - 6),
        e.facing,
      );
      t.aiRole = 'reinforcement';
      this.issueOrder(t, { type: 'attack-move', x: this.model.captureZone.x, z: this.model.captureZone.z, targetId: -1 });
    }
    for (let i = 0; i < 2; i++) {
      const g = this.spawn(
        'enemy',
        'grenadier-squad',
        `GR${i + 1}`,
        e.x + Math.cos(lat) * (i * 10 - 5) - Math.cos(e.facing) * 10,
        e.z + Math.sin(lat) * (i * 10 - 5) - Math.sin(e.facing) * 10,
        e.facing,
      );
      g.aiRole = 'reinforcement';
      this.issueOrder(g, { type: 'attack-move', x: this.model.captureZone.x, z: this.model.captureZone.z, targetId: -1 });
    }
  }

  // --------------------------------------------------------------- orders

  issueOrder(u: UnitState, order: Order): void {
    if (!u.alive) return;
    u.order = order;
    if (order.type === 'move' || order.type === 'attack-move') {
      this.requestPath(u, order.x, order.z);
      if (order.type === 'move') u.targetId = -1;
    } else if (order.type === 'hold' || order.type === 'idle') {
      u.path = null;
    } else if (order.type === 'attack-target') {
      u.targetId = order.targetId;
    }
  }

  requestPath(u: UnitState, x: number, z: number): void {
    u.order.x = x;
    u.order.z = z;
    if (!this.pathQueue.includes(u)) this.pathQueue.push(u);
  }

  private servePathQueue(): void {
    // budget: a few searches per tick keeps worst-case tick time bounded
    this.pathBudget = 3;
    while (this.pathBudget > 0 && this.pathQueue.length > 0) {
      const u = this.pathQueue.shift();
      if (!u || !u.alive) continue;
      const vehicle = ARCHETYPES[u.cls].kind !== 'infantry';
      const path = findPath(this.nav, u.x, u.z, u.order.x, u.order.z, vehicle);
      u.path = path;
      u.pathIndex = 0;
      this.pathBudget--;
    }
  }

  // ----------------------------------------------------------------- tick

  /** Systems attached from later phases (combat, AI, capture…). */
  readonly systems: { name: string; tick: (gs: GameState, dt: number) => void }[] = [];

  tick(dt: number): void {
    if (this.missionState !== 'running') return;
    this.missionTime += dt;

    // order progress: units with a distant move goal and no path re-path
    // (covers long routes where A* returned a partial best-effort path)
    for (const u of this.units) {
      if (!u.alive || u.directControl) continue;
      if (u.repathCooldown > 0) u.repathCooldown -= dt;
      const wantsGoal = u.order.type === 'move' || u.order.type === 'attack-move';
      if (wantsGoal && u.path === null && u.repathCooldown <= 0) {
        const d = Math.hypot(u.order.x - u.x, u.order.z - u.z);
        if (d > 6) {
          this.requestPath(u, u.order.x, u.order.z);
          u.repathCooldown = 1.4;
        } else if (u.order.type === 'move') {
          u.order = { ...u.order, type: 'idle' };
        }
      }
    }

    this.servePathQueue();
    this.movement.tick(this.units, dt);
    for (const s of this.systems) s.tick(this, dt);

    // mission timer (hard difficulty)
    const timer = this.tuning.missionTimerS;
    if (timer !== null && this.missionTime > timer) {
      this.lose('Time expired — the counterattack overran the sector.');
    }
  }

  win(): void {
    if (this.missionState !== 'running') return;
    this.missionState = 'won';
    this.bus.emit('mission:won', { simTime: this.missionTime });
  }

  lose(reason: string): void {
    if (this.missionState !== 'running') return;
    this.missionState = 'lost';
    this.lossReason = reason;
    this.bus.emit('mission:lost', { simTime: this.missionTime, reason });
  }

  // ---------------------------------------------------------------- stats

  aliveOf(side: Side): number {
    let n = 0;
    for (const u of this.units) if (u.side === side && u.alive) n++;
    return n;
  }

  totalOf(side: Side): number {
    let n = 0;
    for (const u of this.units) if (u.side === side) n++;
    return n;
  }

  spottedEnemies(): number {
    let n = 0;
    for (const u of this.units) if (u.side === 'enemy' && u.alive && u.spotted) n++;
    return n;
  }

  wreckCount(): number {
    let n = 0;
    for (const u of this.units) if (u.isWreck) n++;
    return n;
  }

  /** Extended by capture/projectile systems via the fields they publish. */
  captureStateLabel = 'Neutral';
  captureProgress = 0;
  projectilesLive = 0;

  publishStats(simTick: number, simTime: number, mode: OcGameStats['mode']): OcGameStats {
    return {
      simTick,
      simTime,
      mode,
      playerUnits: this.totalOf('player'),
      enemyUnits: this.totalOf('enemy'),
      playerAlive: this.aliveOf('player'),
      enemyAlive: this.aliveOf('enemy'),
      spottedEnemies: this.spottedEnemies(),
      projectilesLive: this.projectilesLive,
      projectilesFired: this.projectilesFired,
      projectileHits: this.projectileHits,
      unitsDestroyed: this.unitsDestroyed,
      wrecks: this.wreckCount(),
      captureState: this.captureStateLabel,
      captureProgress: this.captureProgress,
      missionState: this.missionState === 'running' ? 'running' : this.missionState,
      reinforcementsTriggered: this.reinforcementsTriggered,
      audioEvents: this.audioEvents,
      shotsByPlayer: this.shotsByPlayer,
      shotsByEnemy: this.shotsByEnemy,
    };
  }
}

// re-export tuning for AI systems
export { TUNING };
