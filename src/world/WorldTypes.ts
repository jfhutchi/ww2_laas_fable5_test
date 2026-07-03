/**
 * The world layout model — the single source of truth produced by
 * world/Layout.ts and consumed by every mesh generator, the nav grid, the
 * cover/LOS systems, minimap painting, and AI placement.
 *
 * Everything is deterministic from the seed. Coordinates are world meters,
 * X east / Z south (three.js XZ ground plane), Y up.
 */

export type RoadKind = 'paved' | 'dirt' | 'damaged';

export interface RoadNode {
  x: number;
  z: number;
}

export interface Road {
  id: number;
  kind: RoadKind;
  width: number;
  /** Polyline through world space; consecutive points ~8-20 m apart. */
  points: RoadNode[];
}

export interface RoadNetwork {
  roads: Road[];
  /** The central crossroads position (objective). */
  center: RoadNode;
}

export type BuildingKind =
  | 'church'
  | 'townhouse-stone'
  | 'townhouse-brick'
  | 'farmhouse'
  | 'barn'
  | 'shed';

export type DamageState = 'intact' | 'damaged' | 'ruined';

export interface BuildingSpec {
  id: number;
  kind: BuildingKind;
  /** Footprint center. */
  x: number;
  z: number;
  /** Rotation around Y (radians). Front door faces +Z locally. */
  rotation: number;
  /** Footprint half-extents (meters). */
  halfW: number;
  halfD: number;
  /** Eaves height (meters); roof adds on top. */
  wallHeight: number;
  floors: 1 | 2;
  damage: DamageState;
  /** Deterministic per-building style seed. */
  seed: number;
}

export type BarrierKind = 'stone-wall' | 'hedgerow' | 'fence';

export interface BarrierSegment {
  id: number;
  kind: BarrierKind;
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  /** Visual + cover height in meters. */
  height: number;
  /** True if vehicles cannot pass (hedgerow berms, tall walls). */
  blocksVehicles: boolean;
  /** True if it fully blocks infantry sight (hedgerow); low walls only reduce. */
  blocksSight: boolean;
  /** Damage: 0 intact … 1 rubble gap. */
  broken: number;
  seed: number;
}

export type CropKind = 'wheat' | 'pasture' | 'plow' | 'orchard' | 'hay';

export interface FieldSpec {
  id: number;
  crop: CropKind;
  /** Convex polygon (CCW) in world space. */
  polygon: RoadNode[];
  /** Row direction (radians) for crop rows / orchard grid. */
  rowDir: number;
  seed: number;
}

export type PropKind =
  | 'tree-oak'
  | 'tree-poplar'
  | 'tree-apple'
  | 'bush'
  | 'cart'
  | 'crate'
  | 'barrel'
  | 'pole'
  | 'sign'
  | 'rubble'
  | 'well'
  | 'haystack'
  | 'trough';

export interface PropSpec {
  id: number;
  kind: PropKind;
  x: number;
  z: number;
  rotation: number;
  scale: number;
  seed: number;
}

export interface CraterSpec {
  id: number;
  x: number;
  z: number;
  radius: number;
  depth: number;
  /** 0..1 age — fresh craters are darker/scorched. */
  age: number;
}

export interface SmokeSourceSpec {
  id: number;
  x: number;
  z: number;
  /** Column strength 0..1 (building fires on damaged structures). */
  strength: number;
}

export interface ZoneInfo {
  kind:
    | 'village-center'
    | 'residential'
    | 'church-square'
    | 'bocage-lanes'
    | 'fields'
    | 'approach-road'
    | 'lowland';
  x: number;
  z: number;
  radius: number;
}

export interface SpawnArea {
  x: number;
  z: number;
  /** Facing toward the objective (radians). */
  facing: number;
}

export interface WorldModel {
  seed: number;
  roads: RoadNetwork;
  buildings: BuildingSpec[];
  barriers: BarrierSegment[];
  fields: FieldSpec[];
  props: PropSpec[];
  craters: CraterSpec[];
  smokeSources: SmokeSourceSpec[];
  zones: ZoneInfo[];
  captureZone: { x: number; z: number; radius: number };
  playerSpawn: SpawnArea;
  /** Defensive anchor points chosen from tactically sensible cover. */
  enemyAnchors: {
    atGun: SpawnArea;
    mgNests: SpawnArea[];
    infantry: SpawnArea[];
    armor: SpawnArea;
    reinforcementsEntry: SpawnArea;
  };
}

/** Terrain height + surface classification shared by renderers and sim. */
export interface GroundSampler {
  height(x: number, z: number): number;
  /** 0..1 how much the point is road surface (1 = center of a road). */
  roadMask(x: number, z: number): number;
  /** Which road kind dominates at the point (only meaningful when roadMask > 0). */
  roadKind(x: number, z: number): RoadKind;
  /** Field at the point, or null. */
  fieldAt(x: number, z: number): FieldSpec | null;
  /** Crater displacement already applied to height(); mask for material use. */
  craterMask(x: number, z: number): number;
}

// ----------------------------------------------------------------- helpers

export function pointInPolygon(px: number, pz: number, poly: readonly RoadNode[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (!a || !b) continue;
    const intersects = a.z > pz !== b.z > pz && px < ((b.x - a.x) * (pz - a.z)) / (b.z - a.z) + a.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

export function polygonCentroid(poly: readonly RoadNode[]): RoadNode {
  let x = 0;
  let z = 0;
  for (const p of poly) {
    x += p.x;
    z += p.z;
  }
  const n = Math.max(1, poly.length);
  return { x: x / n, z: z / n };
}

export function polygonArea(poly: readonly RoadNode[]): number {
  let area = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (!a || !b) continue;
    area += (b.x + a.x) * (b.z - a.z);
  }
  return Math.abs(area / 2);
}

/** Distance from point to segment. */
export function distToSegment(px: number, pz: number, x0: number, z0: number, x1: number, z1: number): number {
  const dx = x1 - x0;
  const dz = z1 - z0;
  const lenSq = dx * dx + dz * dz;
  let t = lenSq > 0 ? ((px - x0) * dx + (pz - z0) * dz) / lenSq : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const cx = x0 + t * dx;
  const cz = z0 + t * dz;
  return Math.hypot(px - cx, pz - cz);
}
