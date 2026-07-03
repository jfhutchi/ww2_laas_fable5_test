/**
 * Simulation data model: unit archetypes, weapons, orders, runtime unit
 * state. Stats are gameplay-tuned abstractions of 1944 equipment — armor in
 * abstract millimetres, penetration falls off with range, HE suppresses.
 */

export type Side = 'player' | 'enemy';

export type UnitClass =
  | 'sherman'
  | 'stug'
  | 'panzer4'
  | 'rifle-squad'
  | 'scout-team'
  | 'grenadier-squad'
  | 'at-gun'
  | 'mg-team';

export type WeaponKind = 'cannon' | 'mg' | 'rifle' | 'grenade';

export interface WeaponSpec {
  name: string;
  kind: WeaponKind;
  /** AP penetration at 100 m in abstract mm (0 = no AP capability). */
  penetration: number;
  /** Penetration multiplier remaining at max range. */
  penFalloff: number;
  /** Damage on penetration / direct infantry hit. */
  damage: number;
  /** HE blast radius (m); 0 = kinetic only. */
  blastRadius: number;
  /** Blast damage at centre (falls to 0 at radius). */
  blastDamage: number;
  /** Suppression added to infantry near impacts/bursts. */
  suppression: number;
  /** Max engagement range (m). */
  range: number;
  /** Seconds between shots (cannon) or bursts (mg/rifle). */
  reload: number;
  /** Projectile speed m/s (cannon); hitscan when 0. */
  projectileSpeed: number;
  /** Base hit probability at half range vs exposed target (0..1). */
  accuracy: number;
  /** Rounds per burst for hitscan weapons. */
  burst: number;
  /** True when the weapon can only engage what the hull/mount faces (casemate/AT gun arc). */
  arcLimited: boolean;
  /** Half-angle of the traverse arc when arcLimited (radians). */
  arcHalf: number;
}

export interface ArmorSpec {
  front: number;
  side: number;
  rear: number;
  top: number;
}

export interface UnitArchetype {
  cls: UnitClass;
  label: string;
  kind: 'vehicle' | 'infantry' | 'gun';
  maxHp: number;
  /** Vehicles: abstract armor mm by facing. Infantry/guns: 0s. */
  armor: ArmorSpec;
  /** m/s cruise speed (infantry: move speed). */
  speed: number;
  /** Hull turn rate rad/s. */
  turnRate: number;
  /** Turret traverse rad/s (0 = casemate/fixed → hull must turn). */
  turretRate: number;
  /** Collision radius (m). */
  radius: number;
  /** Vision range (m). */
  sight: number;
  weapons: WeaponSpec[];
  /** Infantry squads: soldiers per squad. */
  soldiers: number;
  /** Capture speed contribution (scouts capture slower). */
  captureWeight: number;
  /** Resistance to suppression accumulation (1 = normal). */
  nerve: number;
}

// ------------------------------------------------------------- weapons

const W_75MM_M3: WeaponSpec = {
  name: '75mm M3',
  kind: 'cannon',
  penetration: 88,
  penFalloff: 0.72,
  damage: 42,
  blastRadius: 5.5,
  blastDamage: 30,
  suppression: 0.55,
  range: 210,
  reload: 3.6,
  projectileSpeed: 185,
  accuracy: 0.68,
  burst: 1,
  arcLimited: false,
  arcHalf: Math.PI,
};

const W_75MM_STUK40: WeaponSpec = {
  name: '75mm StuK 40',
  kind: 'cannon',
  penetration: 106,
  penFalloff: 0.78,
  damage: 46,
  blastRadius: 5,
  blastDamage: 28,
  suppression: 0.55,
  range: 230,
  reload: 4.1,
  projectileSpeed: 200,
  accuracy: 0.7,
  burst: 1,
  arcLimited: true,
  arcHalf: 0.21,
};

const W_75MM_KWK40: WeaponSpec = {
  ...W_75MM_STUK40,
  name: '75mm KwK 40',
  arcLimited: false,
  arcHalf: Math.PI,
  reload: 4.3,
};

const W_PAK40: WeaponSpec = {
  ...W_75MM_STUK40,
  name: '75mm PaK 40',
  penetration: 112,
  reload: 4.6,
  range: 240,
  accuracy: 0.74,
  arcLimited: true,
  arcHalf: 0.5,
};

const W_30CAL: WeaponSpec = {
  name: '.30 cal MG',
  kind: 'mg',
  penetration: 4,
  penFalloff: 0.6,
  damage: 3.2,
  blastRadius: 0,
  blastDamage: 0,
  suppression: 0.3,
  range: 130,
  reload: 2.4,
  projectileSpeed: 0,
  accuracy: 0.5,
  burst: 8,
  arcLimited: false,
  arcHalf: Math.PI,
};

const W_MG42: WeaponSpec = {
  name: 'MG 42',
  kind: 'mg',
  penetration: 4,
  penFalloff: 0.6,
  damage: 3.6,
  blastRadius: 0,
  blastDamage: 0,
  suppression: 0.52,
  range: 170,
  reload: 2.8,
  projectileSpeed: 0,
  accuracy: 0.52,
  burst: 12,
  arcLimited: true,
  arcHalf: 0.9,
};

const W_GARAND: WeaponSpec = {
  name: 'M1 rifles',
  kind: 'rifle',
  penetration: 2,
  penFalloff: 0.5,
  damage: 3.4,
  blastRadius: 0,
  blastDamage: 0,
  suppression: 0.14,
  range: 110,
  reload: 2.2,
  projectileSpeed: 0,
  accuracy: 0.42,
  burst: 5,
  arcLimited: false,
  arcHalf: Math.PI,
};

const W_KAR98: WeaponSpec = {
  ...W_GARAND,
  name: 'Kar 98k rifles',
  damage: 3.2,
  burst: 4,
  accuracy: 0.4,
};

const W_CARBINE: WeaponSpec = {
  ...W_GARAND,
  name: 'M1 carbines',
  damage: 2.6,
  range: 90,
  burst: 3,
  accuracy: 0.38,
};

const W_GRENADES: WeaponSpec = {
  name: 'grenades',
  kind: 'grenade',
  penetration: 10,
  penFalloff: 1,
  damage: 9,
  blastRadius: 4,
  blastDamage: 16,
  suppression: 0.5,
  range: 26,
  reload: 6.5,
  projectileSpeed: 14,
  accuracy: 0.6,
  burst: 1,
  arcLimited: false,
  arcHalf: Math.PI,
};

// ----------------------------------------------------------- archetypes

export const ARCHETYPES: Record<UnitClass, UnitArchetype> = {
  sherman: {
    cls: 'sherman',
    label: 'Sherman M4A1',
    kind: 'vehicle',
    maxHp: 100,
    armor: { front: 76, side: 42, rear: 32, top: 22 },
    speed: 7.4,
    turnRate: 1.1,
    turretRate: 1.45,
    radius: 2.6,
    sight: 150,
    weapons: [W_75MM_M3, W_30CAL],
    soldiers: 0,
    captureWeight: 1.4,
    nerve: 1,
  },
  stug: {
    cls: 'stug',
    label: 'StuG III',
    kind: 'vehicle',
    maxHp: 96,
    armor: { front: 84, side: 34, rear: 26, top: 18 },
    speed: 6.2,
    turnRate: 1.0,
    turretRate: 0,
    radius: 2.5,
    sight: 150,
    weapons: [W_75MM_STUK40],
    soldiers: 0,
    captureWeight: 1.4,
    nerve: 1,
  },
  panzer4: {
    cls: 'panzer4',
    label: 'Panzer IV',
    kind: 'vehicle',
    maxHp: 92,
    armor: { front: 72, side: 34, rear: 24, top: 18 },
    speed: 6.8,
    turnRate: 1.05,
    turretRate: 1.15,
    radius: 2.6,
    sight: 150,
    weapons: [W_75MM_KWK40, W_MG42],
    soldiers: 0,
    captureWeight: 1.4,
    nerve: 1,
  },
  'rifle-squad': {
    cls: 'rifle-squad',
    label: 'Rifle Squad',
    kind: 'infantry',
    maxHp: 60, // 6 soldiers × 10
    armor: { front: 0, side: 0, rear: 0, top: 0 },
    speed: 2.6,
    turnRate: 6,
    turretRate: 6,
    radius: 2.4,
    sight: 120,
    weapons: [W_GARAND, W_GRENADES],
    soldiers: 6,
    captureWeight: 1,
    nerve: 1,
  },
  'scout-team': {
    cls: 'scout-team',
    label: 'Scout Team',
    kind: 'infantry',
    maxHp: 30,
    armor: { front: 0, side: 0, rear: 0, top: 0 },
    speed: 3.3,
    turnRate: 6,
    turretRate: 6,
    radius: 1.8,
    sight: 185,
    weapons: [W_CARBINE],
    soldiers: 3,
    captureWeight: 0.45,
    nerve: 0.85,
  },
  'grenadier-squad': {
    cls: 'grenadier-squad',
    label: 'Grenadier Squad',
    kind: 'infantry',
    maxHp: 50,
    armor: { front: 0, side: 0, rear: 0, top: 0 },
    speed: 2.5,
    turnRate: 6,
    turretRate: 6,
    radius: 2.2,
    sight: 120,
    weapons: [W_KAR98, W_GRENADES],
    soldiers: 5,
    captureWeight: 1,
    nerve: 1,
  },
  'at-gun': {
    cls: 'at-gun',
    label: 'PaK 40 AT Gun',
    kind: 'gun',
    maxHp: 45,
    armor: { front: 8, side: 0, rear: 0, top: 0 },
    speed: 0.9,
    turnRate: 0.5,
    turretRate: 0.5,
    radius: 2.2,
    sight: 195,
    weapons: [W_PAK40],
    soldiers: 4,
    captureWeight: 0.8,
    nerve: 0.9,
  },
  'mg-team': {
    cls: 'mg-team',
    label: 'MG 42 Team',
    kind: 'gun',
    maxHp: 32,
    armor: { front: 0, side: 0, rear: 0, top: 0 },
    speed: 1.9,
    turnRate: 3,
    turretRate: 3,
    radius: 1.8,
    sight: 170,
    weapons: [W_MG42],
    soldiers: 3,
    captureWeight: 0.8,
    nerve: 1.1,
  },
};

// ------------------------------------------------------------- runtime

export type OrderType =
  | 'idle'
  | 'move'
  | 'attack-move'
  | 'attack-target'
  | 'attack-ground'
  | 'hold';

export interface Order {
  type: OrderType;
  x: number;
  z: number;
  targetId: number;
}

export interface SoldierState {
  /** Formation offset (local). */
  dx: number;
  dz: number;
  /** World position (lags formation for organic motion). */
  x: number;
  z: number;
  alive: boolean;
  /** Animation phase offset. */
  phase: number;
}

export interface WeaponState {
  cooldown: number;
  /** Remaining reload time visible in HUD (cannons). */
  reloadLeft: number;
}

export interface CritState {
  mobility: boolean;
  turret: boolean;
  burning: boolean;
  burnTime: number;
}

export interface UnitState {
  id: number;
  side: Side;
  cls: UnitClass;
  /** Roster designation, e.g. "1" for Sherman 1. */
  callsign: string;

  x: number;
  z: number;
  y: number;
  yaw: number;
  /** Absolute turret facing (vehicles with turrets). */
  turretYaw: number;
  vel: number;

  hp: number;
  alive: boolean;
  /** Vehicles leave a wreck after destruction. */
  isWreck: boolean;
  crits: CritState;

  suppression: number;
  pinned: boolean;
  inCoverQuality: number;

  order: Order;
  path: { x: number; z: number }[] | null;
  pathIndex: number;
  repathCooldown: number;

  targetId: number;
  weapons: WeaponState[];
  soldiers: SoldierState[];

  /** Player-side knowledge: enemy currently spotted by the player side. */
  spotted: boolean;
  spotLinger: number;

  /** Enemy AI bookkeeping. */
  aiRole: 'at' | 'mg' | 'infantry' | 'armor' | 'reinforcement' | 'none';
  aiTimer: number;
  homeX: number;
  homeZ: number;
  homeFacing: number;

  /** True while the player directly controls this vehicle (tank mode). */
  directControl: boolean;
  /** Direct-control inputs (throttle -1..1, steer -1..1, fire flags). */
  driveThrottle: number;
  driveSteer: number;
}

export function makeUnit(
  id: number,
  side: Side,
  cls: UnitClass,
  callsign: string,
  x: number,
  z: number,
  yaw: number,
): UnitState {
  const arch = ARCHETYPES[cls];
  const soldiers: SoldierState[] = [];
  for (let i = 0; i < arch.soldiers; i++) {
    const row = Math.floor(i / 3);
    const col = i % 3;
    const dx = (col - 1) * 1.7 + (row % 2 === 1 ? 0.6 : 0);
    const dz = row * 1.6;
    soldiers.push({ dx, dz, x: x + dx, z: z + dz, alive: true, phase: (i * 0.61803) % 1 });
  }
  return {
    id,
    side,
    cls,
    callsign,
    x,
    z,
    y: 0,
    yaw,
    turretYaw: yaw,
    vel: 0,
    hp: arch.maxHp,
    alive: true,
    isWreck: false,
    crits: { mobility: false, turret: false, burning: false, burnTime: 0 },
    suppression: 0,
    pinned: false,
    inCoverQuality: 0,
    order: { type: 'idle', x, z, targetId: -1 },
    path: null,
    pathIndex: 0,
    repathCooldown: 0,
    targetId: -1,
    weapons: arch.weapons.map(() => ({ cooldown: 0, reloadLeft: 0 })),
    soldiers,
    spotted: false,
    spotLinger: 0,
    aiRole: 'none',
    aiTimer: 0,
    homeX: x,
    homeZ: z,
    homeFacing: yaw,
    directControl: false,
    driveThrottle: 0,
    driveSteer: 0,
  };
}
