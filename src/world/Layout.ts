/**
 * Deterministic Normandy layout generator. Produces the WorldModel: road
 * network with a central crossroads, the village (church, town core,
 * farmsteads), bocage field patchwork with hedgerow boundaries, stone walls,
 * scatter props, war damage, capture zone and tactically-chosen spawn/anchor
 * points. Pure function of the seed.
 */

import { rootRng } from '../core/Random.ts';
import { fbm2D } from '../core/Noise.ts';
import { clamp } from '../core/MathUtil.ts';
import { CAPTURE_RADIUS, PLAY_HALF, VILLAGE_RADIUS } from './WorldConst.ts';
import type {
  BarrierKind,
  BarrierSegment,
  BuildingKind,
  BuildingSpec,
  CraterSpec,
  DamageState,
  FieldSpec,
  PropKind,
  PropSpec,
  Road,
  RoadNode,
  SmokeSourceSpec,
  WorldModel,
  ZoneInfo,
} from './WorldTypes.ts';
import { distToSegment, pointInPolygon } from './WorldTypes.ts';

// obstacle bookkeeping to prevent overlaps during placement
interface PlacedRect {
  x: number;
  z: number;
  hw: number;
  hd: number;
  rot: number;
}

let nextId = 1;
function id(): number {
  return nextId++;
}

export function generateLayout(seed: number): WorldModel {
  nextId = 1;
  const rng = rootRng(seed);
  const roadsRng = rng.fork('roads');
  const villageRng = rng.fork('village');
  const fieldRng = rng.fork('fields');
  const barrierRng = rng.fork('barriers');
  const propRng = rng.fork('props');
  const damageRng = rng.fork('damage');

  const roads: Road[] = [];
  const buildings: BuildingSpec[] = [];
  const barriers: BarrierSegment[] = [];
  const fields: FieldSpec[] = [];
  const props: PropSpec[] = [];
  const craters: CraterSpec[] = [];
  const smokeSources: SmokeSourceSpec[] = [];
  const placed: PlacedRect[] = [];

  // ------------------------------------------------------------- 1. roads

  // Four arms leaving the crossroads. North = -Z. Player approaches from south.
  const armAngles = [
    -Math.PI / 2 + roadsRng.range(-0.12, 0.12), // north (toward -Z)
    0 + roadsRng.range(-0.14, 0.14), // east
    Math.PI / 2 + roadsRng.range(-0.12, 0.12), // south
    Math.PI + roadsRng.range(-0.14, 0.14), // west
  ] as const;

  const armKinds = ['paved', 'dirt', 'damaged', 'dirt'] as const;
  const armWidths = [7.2, 5.4, 7.2, 5.6] as const;
  const armPoints: RoadNode[][] = [];

  for (let a = 0; a < 4; a++) {
    const angle = armAngles[a] ?? 0;
    const pts: RoadNode[] = [{ x: 0, z: 0 }];
    let dir = angle;
    let px = 0;
    let pz = 0;
    const step = 16;
    const length = PLAY_HALF * 1.35;
    for (let d = step; d <= length; d += step) {
      // meander softly; keep villages straight-ish near center
      const wander = fbm2D(d * 0.006, a * 31.7, seed ^ 0xa11, 3) - 0.5;
      const damping = clamp(d / 220, 0, 1);
      dir = angle + wander * 0.55 * damping;
      px += Math.cos(dir) * step;
      pz += Math.sin(dir) * step;
      pts.push({ x: px, z: pz });
    }
    armPoints.push(pts);
    roads.push({ id: id(), kind: armKinds[a] ?? 'dirt', width: armWidths[a] ?? 5.4, points: pts });
  }

  // Connector lanes between adjacent arms (bocage lanes)
  const lanePairs: [number, number, number][] = [
    [0, 1, roadsRng.range(200, 300)], // NE lane
    [2, 3, roadsRng.range(220, 330)], // SW lane
  ];
  for (const [a, b, radius] of lanePairs) {
    const pa = pointAtRadius(armPoints[a] ?? [], radius);
    const pb = pointAtRadius(armPoints[b] ?? [], radius * roadsRng.range(0.85, 1.15));
    if (!pa || !pb) continue;
    const pts: RoadNode[] = [];
    const segs = 14;
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      const mx = (pa.x + pb.x) / 2 + fbm2D(t * 3.1, a * 17, seed ^ 0xbb, 2) * 60 - 30;
      const mz = (pa.z + pb.z) / 2 + fbm2D(t * 3.1, b * 23, seed ^ 0xcc, 2) * 60 - 30;
      // quadratic bezier through jittered midpoint
      const x = (1 - t) * (1 - t) * pa.x + 2 * (1 - t) * t * mx + t * t * pb.x;
      const z = (1 - t) * (1 - t) * pa.z + 2 * (1 - t) * t * mz + t * t * pb.z;
      pts.push({ x, z });
    }
    roads.push({ id: id(), kind: 'dirt', width: 4.4, points: pts });
  }

  const distToAnyRoad = (x: number, z: number): number => {
    let best = Infinity;
    for (const r of roads) {
      for (let i = 0; i < r.points.length - 1; i++) {
        const p = r.points[i];
        const q = r.points[i + 1];
        if (!p || !q) continue;
        // quick reject
        if (Math.abs(p.x - x) > 220 && Math.abs(q.x - x) > 220) continue;
        if (Math.abs(p.z - z) > 220 && Math.abs(q.z - z) > 220) continue;
        best = Math.min(best, distToSegment(x, z, p.x, p.z, q.x, q.z) - r.width / 2);
      }
    }
    return best;
  };

  // ------------------------------------------------------- 2. the village

  const overlaps = (x: number, z: number, hw: number, hd: number, margin: number): boolean => {
    for (const r of placed) {
      // conservative circle test (fast, fine for layout)
      const rr = Math.hypot(r.hw, r.hd) + Math.hypot(hw, hd) + margin;
      const dx = x - r.x;
      const dz = z - r.z;
      if (dx * dx + dz * dz < rr * rr) return true;
    }
    return false;
  };

  const addBuilding = (
    kind: BuildingKind,
    x: number,
    z: number,
    rotation: number,
    hw: number,
    hd: number,
    wallHeight: number,
    floors: 1 | 2,
    damage: DamageState,
  ): BuildingSpec | null => {
    if (overlaps(x, z, hw, hd, 1.5)) return null;
    const spec: BuildingSpec = {
      id: id(),
      kind,
      x,
      z,
      rotation,
      halfW: hw,
      halfD: hd,
      wallHeight,
      floors,
      damage,
      seed: villageRng.int(1, 2 ** 31),
    };
    buildings.push(spec);
    placed.push({ x, z, hw, hd, rot: rotation });
    if (damage === 'ruined') smokeSources.push({ id: id(), x, z, strength: villageRng.range(0.7, 1) });
    else if (damage === 'damaged' && damageRng.chance(0.4)) {
      smokeSources.push({ id: id(), x, z, strength: villageRng.range(0.25, 0.5) });
    }
    return spec;
  };

  const damageFor = (x: number, z: number): DamageState => {
    // south approach quadrant took the artillery preparation
    const southness = z > 40 && Math.abs(x) < 220 ? 1 : 0;
    const near = Math.hypot(x, z) < 120 ? 0.5 : 0;
    const p = 0.1 + southness * 0.38 + near * 0.15;
    const roll = damageRng.float();
    if (roll < p * 0.42) return 'ruined';
    if (roll < p) return 'damaged';
    return 'intact';
  };

  // --- church on the NE quadrant, slightly off the crossroads
  const churchArm = armPoints[0] ?? [];
  const churchAnchor = pointAtRadius(churchArm, 62) ?? { x: 20, z: -60 };
  const churchDir = dirAtRadius(churchArm, 62) + Math.PI / 2;
  const churchX = churchAnchor.x + Math.cos(churchDir) * 26;
  const churchZ = churchAnchor.z + Math.sin(churchDir) * 26;
  const churchRot = Math.atan2(-churchZ, -churchX) + Math.PI / 2;
  addBuilding('church', churchX, churchZ, churchRot, 7.5, 13.5, 7.5, 2, 'damaged');
  const churchSquare = { x: churchX - Math.cos(churchDir) * 22, z: churchZ - Math.sin(churchDir) * 22 };

  // --- civic ground: a cobbled parvis in front of the church and a small
  // town-square apron at the crossroads. Added to the road network BEFORE
  // housing so frontages naturally address them (they read as paved plazas
  // in the terrain/road meshes and as fast ground in the nav grid).
  roads.push({
    id: id(),
    kind: 'paved',
    width: 24,
    points: [
      { x: churchAnchor.x, z: churchAnchor.z },
      { x: churchSquare.x, z: churchSquare.z },
      {
        x: churchSquare.x + (churchX - churchSquare.x) * 0.45,
        z: churchSquare.z + (churchZ - churchSquare.z) * 0.45,
      },
    ],
  });
  {
    const n0 = pointAtRadius(armPoints[0] ?? [], 16) ?? { x: 0, z: -16 };
    const s0 = pointAtRadius(armPoints[2] ?? [], 16) ?? { x: 0, z: 16 };
    roads.push({ id: id(), kind: 'paved', width: 20, points: [n0, { x: 0, z: 0 }, s0] });
    // rond-point: circular paved ring around the monument/flag, as in the
    // reference frame's village centre
    const ring: RoadNode[] = [];
    for (let i = 0; i <= 22; i++) {
      const a = (i / 22) * Math.PI * 2;
      ring.push({ x: Math.cos(a) * 15, z: Math.sin(a) * 15 });
    }
    roads.push({ id: id(), kind: 'paved', width: 8, points: ring });
  }

  // Rotated-rect test against every placed building (+margin). Barrier
  // pieces must never thread through a house.
  const insideAnyBuilding = (x: number, z: number, margin: number): boolean => {
    for (const b of buildings) {
      const reach = Math.hypot(b.halfW + margin, b.halfD + margin);
      const dx = x - b.x;
      const dz = z - b.z;
      if (dx * dx + dz * dz > reach * reach) continue;
      const cos = Math.cos(b.rotation);
      const sin = Math.sin(b.rotation);
      const lx = dx * cos + dz * sin;
      const lz = -dx * sin + dz * cos;
      if (Math.abs(lx) <= b.halfW + margin && Math.abs(lz) <= b.halfD + margin) return true;
    }
    return false;
  };

  /**
   * Emit a wall/fence run in short pieces, dropping every piece that would
   * cross a road or clip a building — walls end cleanly at obstacles.
   */
  const addBarrierRun = (
    kind: BarrierKind,
    x0: number,
    z0: number,
    x1: number,
    z1: number,
    height: number,
    broken: number,
    roadClearance: number,
  ): void => {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const pieces = Math.max(1, Math.round(len / 5.5));
    for (let p = 0; p < pieces; p++) {
      const t0 = p / pieces;
      const t1 = (p + 1) / pieces;
      let blocked = false;
      for (let s = 0; s <= 3; s++) {
        const t = t0 + ((t1 - t0) * s) / 3;
        const x = x0 + (x1 - x0) * t;
        const z = z0 + (z1 - z0) * t;
        if (distToAnyRoad(x, z) < roadClearance || insideAnyBuilding(x, z, 0.55)) {
          blocked = true;
          break;
        }
      }
      if (blocked) continue;
      addBarrier(kind, x0 + (x1 - x0) * t0, z0 + (z1 - z0) * t0, x0 + (x1 - x0) * t1, z0 + (z1 - z0) * t1, height, broken);
    }
  };

  // --- plaza ring: townhouses enclosing the crossroads square, fronts to
  // the centre, gaps left at the four road exits (reference composition)
  {
    const nRing = 22;
    const angDist = (a: number, b: number): number =>
      Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
    for (let i = 0; i < nRing; i++) {
      const a = (i / nRing) * Math.PI * 2 + villageRng.range(-0.08, 0.08);
      let nearArm = false;
      for (const armA of armAngles) {
        if (angDist(a, armA) < 0.26) {
          nearArm = true;
          break;
        }
      }
      if (nearArm) continue;
      const r = villageRng.range(30, 52);
      const bx = Math.cos(a) * r;
      const bz = Math.sin(a) * r;
      if (Math.hypot(bx - churchX, bz - churchZ) < 24) continue;
      if (distToAnyRoad(bx, bz) < 4.5) continue;
      const kind: BuildingKind = villageRng.chance(0.6) ? 'townhouse-stone' : 'townhouse-brick';
      const hw = villageRng.range(3.8, 5.2);
      const hd = villageRng.range(3.2, 4.2);
      // door faces the square: outward normal points from centre to house
      addBuilding(kind, bx, bz, a + Math.PI / 2, hw, hd, villageRng.range(5.6, 6.6), 2, damageFor(bx, bz));
    }
  }

  // --- town core: walk each arm, place frontage buildings
  for (let a = 0; a < 4; a++) {
    const pts = armPoints[a] ?? [];
    for (const side of [-1, 1]) {
      let d = 56 + villageRng.range(0, 8);
      while (d < 165) {
        const p = pointAtRadius(pts, d);
        const roadDir = dirAtRadius(pts, d);
        if (!p) break;
        const inCore = d < 115;
        const kind: BuildingKind = inCore
          ? villageRng.chance(0.55)
            ? 'townhouse-stone'
            : 'townhouse-brick'
          : villageRng.chance(0.5)
            ? 'farmhouse'
            : villageRng.chance(0.6)
              ? 'barn'
              : 'shed';
        const hw = kind === 'barn' ? villageRng.range(5, 7) : kind === 'shed' ? villageRng.range(2.2, 3) : villageRng.range(3.6, 5.2);
        const hd = kind === 'barn' ? villageRng.range(3.6, 4.6) : kind === 'shed' ? villageRng.range(1.8, 2.6) : villageRng.range(3, 4.4);
        const floors: 1 | 2 = kind === 'townhouse-stone' || kind === 'townhouse-brick' ? 2 : kind === 'farmhouse' && villageRng.chance(0.5) ? 2 : 1;
        const wallH = floors === 2 ? villageRng.range(5.6, 6.6) : villageRng.range(3, 3.8);
        const normal = roadDir + (Math.PI / 2) * side;
        const setback = (armWidths[a] ?? 5.4) / 2 + hd + villageRng.range(1.4, inCore ? 3 : 8);
        const bx = p.x + Math.cos(normal) * setback;
        const bz = p.z + Math.sin(normal) * setback;
        // keep the crossroads square open and off other roads
        if (Math.hypot(bx, bz) > 24 && distToAnyRoad(bx, bz) > hd * 0.5 + 1 && Math.hypot(bx - churchX, bz - churchZ) > 26) {
          const rot = normal + Math.PI / 2; // gable parallel to road, door faces road
          addBuilding(kind, bx, bz, rot, hw, hd, wallH, floors, damageFor(bx, bz));
        }
        d += hw * 2 + villageRng.range(inCore ? 2.5 : 14, inCore ? 7 : 36);
      }
    }
  }

  // --- outlying farmsteads on the connector lanes + far arms
  const farmSites: RoadNode[] = [];
  for (const r of roads.slice(4)) {
    const mid = r.points[Math.floor(r.points.length / 2)];
    if (mid) farmSites.push(mid);
  }
  for (let a = 0; a < 4; a++) {
    const p = pointAtRadius(armPoints[a] ?? [], VILLAGE_RADIUS + 140 + villageRng.range(0, 120));
    if (p) farmSites.push(p);
  }
  for (const site of farmSites) {
    const yardDir = villageRng.range(0, Math.PI * 2);
    const yardDist = villageRng.range(16, 30);
    const cx = site.x + Math.cos(yardDir) * yardDist;
    const cz = site.z + Math.sin(yardDir) * yardDist;
    if (Math.abs(cx) > PLAY_HALF - 60 || Math.abs(cz) > PLAY_HALF - 60) continue;
    const rot = villageRng.range(0, Math.PI * 2);
    addBuilding('farmhouse', cx, cz, rot, 4.6, 3.8, villageRng.chance(0.5) ? 6 : 3.6, villageRng.chance(0.5) ? 2 : 1, damageFor(cx, cz));
    const barnRot = rot + Math.PI / 2 + villageRng.range(-0.2, 0.2);
    addBuilding('barn', cx + Math.cos(rot) * 16, cz + Math.sin(rot) * 16, barnRot, 6, 4.2, 3.4, 1, damageFor(cx, cz));
    if (villageRng.chance(0.7)) {
      addBuilding('shed', cx + Math.cos(rot + 2.2) * 13, cz + Math.sin(rot + 2.2) * 13, rot + villageRng.range(0, 1), 2.4, 2, 2.4, 1, 'intact');
    }
  }

  // top-up to guarantee ≥ 30 structures
  let guard = 0;
  while (buildings.length < 32 && guard++ < 200) {
    const a = villageRng.int(0, 3);
    const d = villageRng.range(VILLAGE_RADIUS * 0.9, PLAY_HALF * 0.7);
    const p = pointAtRadius(armPoints[a] ?? [], d);
    if (!p) continue;
    const roadDir = dirAtRadius(armPoints[a] ?? [], d);
    const side = villageRng.chance(0.5) ? 1 : -1;
    const normal = roadDir + (Math.PI / 2) * side;
    const bx = p.x + Math.cos(normal) * villageRng.range(10, 26);
    const bz = p.z + Math.sin(normal) * villageRng.range(10, 26);
    if (Math.abs(bx) > PLAY_HALF - 50 || Math.abs(bz) > PLAY_HALF - 50) continue;
    if (distToAnyRoad(bx, bz) < 3) continue;
    addBuilding(villageRng.chance(0.5) ? 'barn' : 'shed', bx, bz, normal + Math.PI / 2, 4.5, 3.4, 3.2, 1, damageFor(bx, bz));
  }

  // ------------------------------------------------------------ 3. fields

  const CELLS = 7; // coarse patchwork grid across the playable area
  const cellSize = (PLAY_HALF * 2) / CELLS;
  for (let gz = 0; gz < CELLS; gz++) {
    for (let gx = 0; gx < CELLS; gx++) {
      const cx = -PLAY_HALF + cellSize * (gx + 0.5);
      const cz = -PLAY_HALF + cellSize * (gz + 0.5);
      if (Math.hypot(cx, cz) < VILLAGE_RADIUS * 0.9) continue; // village core is not farmland
      // subdivide some cells for smaller parcels near the village
      const subdivide = Math.hypot(cx, cz) < PLAY_HALF * 0.55 && fieldRng.chance(0.6);
      const parcels: { x: number; z: number; hw: number; hd: number }[] = [];
      if (subdivide) {
        const vertical = fieldRng.chance(0.5);
        if (vertical) {
          parcels.push(
            { x: cx - cellSize / 4, z: cz, hw: cellSize / 4, hd: cellSize / 2 },
            { x: cx + cellSize / 4, z: cz, hw: cellSize / 4, hd: cellSize / 2 },
          );
        } else {
          parcels.push(
            { x: cx, z: cz - cellSize / 4, hw: cellSize / 2, hd: cellSize / 4 },
            { x: cx, z: cz + cellSize / 4, hw: cellSize / 2, hd: cellSize / 4 },
          );
        }
      } else {
        parcels.push({ x: cx, z: cz, hw: cellSize / 2, hd: cellSize / 2 });
      }
      for (const parcel of parcels) {
        const inset = fieldRng.range(4, 9);
        const poly: RoadNode[] = [
          { x: parcel.x - parcel.hw + inset, z: parcel.z - parcel.hd + inset },
          { x: parcel.x + parcel.hw - inset, z: parcel.z - parcel.hd + inset },
          { x: parcel.x + parcel.hw - inset, z: parcel.z + parcel.hd - inset },
          { x: parcel.x - parcel.hw + inset, z: parcel.z + parcel.hd - inset },
        ].map((p) => ({
          x: clamp(p.x + fieldRng.range(-7, 7), -PLAY_HALF + 4, PLAY_HALF - 4),
          z: clamp(p.z + fieldRng.range(-7, 7), -PLAY_HALF + 4, PLAY_HALF - 4),
        }));
        const centroidDistVillage = Math.hypot(parcel.x, parcel.z);
        const crop =
          centroidDistVillage < VILLAGE_RADIUS * 1.7 && fieldRng.chance(0.3)
            ? 'orchard'
            : fieldRng.pick(['wheat', 'pasture', 'plow', 'hay', 'wheat', 'pasture'] as const);
        fields.push({
          id: id(),
          crop,
          polygon: poly,
          rowDir: fieldRng.chance(0.5) ? 0 : Math.PI / 2,
          seed: fieldRng.int(1, 2 ** 31),
        });
      }
    }
  }

  // -------------------------------------------------- 4. barriers/hedges

  const addBarrier = (
    kind: BarrierKind,
    x0: number,
    z0: number,
    x1: number,
    z1: number,
    height: number,
    broken = 0,
  ): void => {
    barriers.push({
      id: id(),
      kind,
      x0,
      z0,
      x1,
      z1,
      height,
      blocksVehicles: kind === 'hedgerow',
      blocksSight: kind === 'hedgerow',
      broken,
      seed: barrierRng.int(1, 2 ** 31),
    });
  };

  // hedgerows around field boundaries, with gaps at roads and gates
  for (const field of fields) {
    if (field.crop === 'orchard' && barrierRng.chance(0.35)) continue; // some open orchards
    const poly = field.polygon;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      if (!a || !b) continue;
      const segLen = Math.hypot(b.x - a.x, b.z - a.z);
      const pieces = Math.max(1, Math.round(segLen / 9));
      const gateAt = barrierRng.chance(0.5) ? barrierRng.int(0, pieces - 1) : -1;
      for (let p = 0; p < pieces; p++) {
        if (p === gateAt) continue; // gate gap
        const t0 = p / pieces;
        const t1 = (p + 1) / pieces;
        const x0 = a.x + (b.x - a.x) * t0;
        const z0 = a.z + (b.z - a.z) * t0;
        const x1 = a.x + (b.x - a.x) * t1;
        const z1 = a.z + (b.z - a.z) * t1;
        // skip pieces that cross or crowd a road — sample along the piece,
        // not just the midpoint, so field boundaries never wall off a road
        let blockedPiece = false;
        for (let s = 0; s <= 4; s++) {
          const t = s / 4;
          const sx = x0 + (x1 - x0) * t;
          const sz = z0 + (z1 - z0) * t;
          if (distToAnyRoad(sx, sz) < 3.2 || insideAnyBuilding(sx, sz, 0.8)) {
            blockedPiece = true;
            break;
          }
        }
        if (blockedPiece) continue;
        const mx = (x0 + x1) / 2;
        const mz = (z0 + z1) / 2;
        if (Math.hypot(mx, mz) < VILLAGE_RADIUS * 0.48) continue;
        const h = barrierRng.range(2.1, 3.2);
        addBarrier('hedgerow', x0, z0, x1, z1, h, 0);
      }
    }
  }

  // stone walls: churchyard + village garden plots + roadside in core
  const churchyard = 16;
  const cyRot = churchRot;
  const cyCorners: RoadNode[] = [
    rotOffset(churchX, churchZ, -churchyard, -churchyard * 1.2, cyRot),
    rotOffset(churchX, churchZ, churchyard, -churchyard * 1.2, cyRot),
    rotOffset(churchX, churchZ, churchyard, churchyard * 1.2, cyRot),
    rotOffset(churchX, churchZ, -churchyard, churchyard * 1.2, cyRot),
  ];
  for (let i = 0; i < 4; i++) {
    const a = cyCorners[i];
    const b = cyCorners[(i + 1) % 4];
    if (!a || !b) continue;
    // leave a gate on the road-facing side
    if (i === 3) {
      const gx = (a.x + b.x) / 2;
      const gz = (a.z + b.z) / 2;
      addBarrierRun('stone-wall', a.x, a.z, gx - (gx - a.x) * 0.25, gz - (gz - a.z) * 0.25, 1.3, 0, 1.6);
      addBarrierRun('stone-wall', gx + (b.x - gx) * 0.25, gz + (b.z - gz) * 0.25, b.x, b.z, 1.3, 0, 1.6);
    } else {
      addBarrierRun('stone-wall', a.x, a.z, b.x, b.z, 1.3, damageRng.chance(0.3) ? damageRng.range(0.2, 0.7) : 0, 1.6);
    }
  }

  for (const b of buildings) {
    if (b.kind !== 'townhouse-stone' && b.kind !== 'townhouse-brick' && b.kind !== 'farmhouse') continue;
    if (barrierRng.chance(0.45)) continue;
    // back-garden wall behind the building
    const back = b.rotation + Math.PI;
    const gw = b.halfW + barrierRng.range(2, 5);
    const gd = barrierRng.range(6, 12);
    const c0 = rotOffset(b.x, b.z, -gw, b.halfD, b.rotation);
    const c1 = rotOffset(b.x, b.z, gw, b.halfD, b.rotation);
    const c2 = rotOffset(b.x, b.z, gw, b.halfD + gd, b.rotation);
    const c3 = rotOffset(b.x, b.z, -gw, b.halfD + gd, b.rotation);
    void back;
    const wallH = barrierRng.range(1, 1.35);
    const brokenAmt = b.damage === 'ruined' ? 0.7 : b.damage === 'damaged' ? 0.35 : 0;
    addBarrierRun('stone-wall', c0.x, c0.z, c3.x, c3.z, wallH, brokenAmt * barrierRng.float(), 2.2);
    addBarrierRun('stone-wall', c1.x, c1.z, c2.x, c2.z, wallH, brokenAmt * barrierRng.float(), 2.2);
    addBarrierRun('stone-wall', c3.x, c3.z, c2.x, c2.z, wallH, brokenAmt * barrierRng.float(), 2.2);
  }

  // pasture fences
  for (const field of fields) {
    if (field.crop !== 'pasture' || barrierRng.chance(0.5)) continue;
    const poly = field.polygon;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      if (!a || !b) continue;
      const inX = (b.x - a.x) * 0.12;
      const inZ = (b.z - a.z) * 0.12;
      addBarrierRun('fence', a.x + inX, a.z + inZ, b.x - inX, b.z - inZ, 1.05, 0, 3.5);
    }
  }

  // ------------------------------------------------------------ 5. craters

  // artillery-prepared southern approach
  const southArm = armPoints[2] ?? [];
  for (let i = 0; i < 13; i++) {
    const d = damageRng.range(60, 420);
    const p = pointAtRadius(southArm, d);
    if (!p) continue;
    const off = damageRng.range(-16, 16);
    const roadDir = dirAtRadius(southArm, d);
    craters.push({
      id: id(),
      x: p.x + Math.cos(roadDir + Math.PI / 2) * off,
      z: p.z + Math.sin(roadDir + Math.PI / 2) * off,
      radius: damageRng.range(2.6, 5),
      depth: damageRng.range(0.5, 1.15),
      age: damageRng.float(),
    });
  }
  // scattered strikes around the village
  for (let i = 0; i < 9; i++) {
    const ang = damageRng.range(0, Math.PI * 2);
    const r = damageRng.range(40, 260);
    craters.push({
      id: id(),
      x: Math.cos(ang) * r,
      z: Math.sin(ang) * r,
      radius: damageRng.range(2, 4),
      depth: damageRng.range(0.4, 0.9),
      age: damageRng.float(),
    });
  }

  // ------------------------------------------------------------- 6. props

  const addProp = (kind: PropKind, x: number, z: number, rotation: number, scale: number): void => {
    props.push({ id: id(), kind, x, z, rotation, scale, seed: propRng.int(1, 2 ** 31) });
  };

  // poplar avenue along the west arm
  const west = armPoints[3] ?? [];
  for (let d = 90; d < 460; d += 17) {
    const p = pointAtRadius(west, d);
    if (!p) break;
    const roadDir = dirAtRadius(west, d);
    for (const side of [-1, 1]) {
      if (propRng.chance(0.12)) continue; // gaps
      const n = roadDir + (Math.PI / 2) * side;
      addProp('tree-poplar', p.x + Math.cos(n) * 6.4, p.z + Math.sin(n) * 6.4, propRng.range(0, 6.28), propRng.range(0.85, 1.2));
    }
  }

  // roadside trees framing the N/E/S approaches (the W arm has the poplar avenue)
  for (const armIdx of [0, 1, 2]) {
    const arm = armPoints[armIdx] ?? [];
    for (let d = 84; d < 430; d += propRng.range(13, 21)) {
      const p = pointAtRadius(arm, d);
      if (!p) break;
      const roadDir = dirAtRadius(arm, d);
      for (const side of [-1, 1]) {
        if (propRng.chance(0.32)) continue; // natural gaps
        const n = roadDir + (Math.PI / 2) * side;
        const off = 5.8 + propRng.range(0, 1.8);
        const tx = p.x + Math.cos(n) * off;
        const tz = p.z + Math.sin(n) * off;
        if (insideAnyBuilding(tx, tz, 1.5) || distToAnyRoad(tx, tz) < 3) continue;
        const kind: PropKind = propRng.chance(0.55) ? 'tree-oak' : 'tree-poplar';
        addProp(kind, tx, tz, propRng.range(0, 6.28), propRng.range(0.82, 1.25));
      }
    }
  }

  // hedge oaks on hedgerow lines (denser: fewer skips than before)
  for (const seg of barriers) {
    if (seg.kind !== 'hedgerow' || propRng.chance(0.35)) continue;
    const t = propRng.float();
    const x = seg.x0 + (seg.x1 - seg.x0) * t;
    const z = seg.z0 + (seg.z1 - seg.z0) * t;
    addProp('tree-oak', x, z, propRng.range(0, 6.28), propRng.range(0.8, 1.35));
  }

  // orchard grids
  for (const field of fields) {
    if (field.crop !== 'orchard') continue;
    const c = centroid(field.polygon);
    const cos = Math.cos(field.rowDir);
    const sin = Math.sin(field.rowDir);
    for (let u = -4; u <= 4; u++) {
      for (let v = -4; v <= 4; v++) {
        const x = c.x + (u * 7.5 + propRng.range(-0.9, 0.9)) * cos - (v * 7 + propRng.range(-0.9, 0.9)) * sin;
        const z = c.z + (u * 7.5) * sin + (v * 7) * cos;
        if (!pointInPolygon(x, z, field.polygon)) continue;
        if (distToAnyRoad(x, z) < 4) continue;
        addProp('tree-apple', x, z, propRng.range(0, 6.28), propRng.range(0.8, 1.15));
      }
    }
  }

  // village clutter: carts, crates, barrels, wells, troughs, haystacks
  addProp('well', churchSquare.x, churchSquare.z, propRng.range(0, 6.28), 1);
  for (const b of buildings) {
    const yard = rotOffset(b.x, b.z, propRng.range(-b.halfW, b.halfW), b.halfD + propRng.range(2, 5), b.rotation);
    if (distToAnyRoad(yard.x, yard.z) < 2) continue;
    if (b.kind === 'barn' || b.kind === 'farmhouse') {
      if (propRng.chance(0.6)) addProp('cart', yard.x, yard.z, propRng.range(0, 6.28), propRng.range(0.9, 1.1));
      if (propRng.chance(0.6)) addProp('haystack', yard.x + propRng.range(-6, 6), yard.z + propRng.range(-6, 6), propRng.range(0, 6.28), propRng.range(0.8, 1.3));
      if (propRng.chance(0.5)) addProp('trough', yard.x + propRng.range(-4, 4), yard.z + propRng.range(-4, 4), propRng.range(0, 6.28), 1);
    } else if (b.kind !== 'church') {
      if (propRng.chance(0.5)) addProp('crate', yard.x, yard.z, propRng.range(0, 6.28), propRng.range(0.8, 1.2));
      if (propRng.chance(0.5)) addProp('barrel', yard.x + propRng.range(-3, 3), yard.z + propRng.range(-3, 3), propRng.range(0, 6.28), 1);
    }
    if (b.damage !== 'intact') {
      const n = b.damage === 'ruined' ? 4 : 2;
      for (let i = 0; i < n; i++) {
        const r = rotOffset(b.x, b.z, propRng.range(-b.halfW - 3, b.halfW + 3), propRng.range(-b.halfD - 3, b.halfD + 3), b.rotation);
        addProp('rubble', r.x, r.z, propRng.range(0, 6.28), propRng.range(0.8, 1.6));
      }
    }
  }

  // telephone poles along the paved north arm + signs at the crossroads
  const north = armPoints[0] ?? [];
  for (let d = 40; d < 700; d += 42) {
    const p = pointAtRadius(north, d);
    if (!p) break;
    const roadDir = dirAtRadius(north, d);
    const n = roadDir + Math.PI / 2;
    addProp('pole', p.x + Math.cos(n) * 5.2, p.z + Math.sin(n) * 5.2, roadDir, 1);
  }
  addProp('sign', 6.5, 7.5, armAngles[2] ?? 0, 1);
  addProp('sign', -7, -6, armAngles[0] ?? 0, 1);

  // bushes along walls
  for (const seg of barriers) {
    if (seg.kind !== 'stone-wall' || propRng.chance(0.6)) continue;
    const t = propRng.float();
    const x = seg.x0 + (seg.x1 - seg.x0) * t + propRng.range(-1, 1);
    const z = seg.z0 + (seg.z1 - seg.z0) * t + propRng.range(-1, 1);
    addProp('bush', x, z, propRng.range(0, 6.28), propRng.range(0.7, 1.4));
  }

  // ------------------------------------------------------------- 7. zones

  const approachMid = pointAtRadius(southArm, 260) ?? { x: 0, z: 260 };
  const eastMid = pointAtRadius(armPoints[1] ?? [], 320) ?? { x: 320, z: 0 };
  const zones: ZoneInfo[] = [
    { kind: 'village-center', x: 0, z: 0, radius: 95 },
    { kind: 'church-square', x: churchSquare.x, z: churchSquare.z, radius: 45 },
    { kind: 'residential', x: -60, z: 60, radius: 90 },
    { kind: 'bocage-lanes', x: eastMid.x, z: eastMid.z, radius: 160 },
    { kind: 'fields', x: -PLAY_HALF * 0.55, z: -PLAY_HALF * 0.5, radius: 240 },
    { kind: 'approach-road', x: approachMid.x, z: approachMid.z, radius: 180 },
  ];

  // ---------------------------------------------------- 8. spawns/anchors

  const playerP = pointAtRadius(southArm, 640) ?? { x: 0, z: 640 };
  const playerFacing = Math.atan2(-playerP.z, -playerP.x);

  // AT gun: sited on the road shoulder, firing straight down the southern
  // approach — the classic PaK position covering the axis of advance.
  const atP = pointAtRadius(southArm, 96) ?? { x: 0, z: 96 };
  const atDir = dirAtRadius(southArm, 96); // points outward (south, toward the player)
  const atSide = damageRng.chance(0.5) ? 1 : -1;
  const atPos = {
    x: atP.x + Math.cos(atDir + (Math.PI / 2) * atSide) * 4.2,
    z: atP.z + Math.sin(atDir + (Math.PI / 2) * atSide) * 4.2,
  };

  // Defensive positions sit at the player-facing EDGE of buildings (outside
  // the footprint, behind its corner cover) — never inside the walls.
  const edgeAnchor = (b: BuildingSpec): { x: number; z: number; facing: number } => {
    const facing = Math.atan2(playerP.z - b.z, playerP.x - b.x);
    const standoff = Math.max(b.halfW, b.halfD) + 3.2;
    return {
      x: b.x + Math.cos(facing) * standoff,
      z: b.z + Math.sin(facing) * standoff,
      facing,
    };
  };

  // MG nests: flanking buildings/walls overlooking approaches
  const mgCandidates = buildings
    .filter((b) => Math.hypot(b.x, b.z) < 150 && b.kind !== 'shed' && b.kind !== 'church')
    .slice(0, 12);
  const mg1 = mgCandidates.find((b) => b.z > 30) ?? mgCandidates[0];
  const mg2 = mgCandidates.find((b) => b.x > 30 && b !== mg1) ?? mgCandidates[1] ?? mg1;
  const mgNests = [mg1, mg2].filter((b): b is BuildingSpec => b !== undefined).map(edgeAnchor);

  // infantry anchor points: building corners around the center
  const infantry = buildings
    .filter((b) => Math.hypot(b.x, b.z) < 190 && b.kind !== 'church')
    .slice(0, 10)
    .map(edgeAnchor);

  // enemy armor: NE behind the village
  const armorP = pointAtRadius(armPoints[1] ?? [], 150) ?? { x: 150, z: 0 };
  const armorPos = { x: armorP.x, z: armorP.z - 30 };

  const reinforceP = pointAtRadius(north, 680) ?? { x: 0, z: -680 };

  const model: WorldModel = {
    seed,
    roads: { roads, center: { x: 0, z: 0 } },
    buildings,
    barriers,
    fields,
    props,
    craters,
    smokeSources,
    zones,
    captureZone: { x: 0, z: 0, radius: CAPTURE_RADIUS },
    playerSpawn: { x: playerP.x, z: playerP.z, facing: playerFacing },
    enemyAnchors: {
      atGun: { x: atPos.x, z: atPos.z, facing: Math.atan2(playerP.z - atPos.z, playerP.x - atPos.x) },
      mgNests,
      infantry,
      armor: { x: armorPos.x, z: armorPos.z, facing: Math.atan2(-armorPos.z, -armorPos.x) },
      reinforcementsEntry: { x: reinforceP.x, z: reinforceP.z, facing: Math.atan2(-reinforceP.z, -reinforceP.x) },
    },
  };
  return model;
}

// ------------------------------------------------------------------ utils

function pointAtRadius(pts: readonly RoadNode[], d: number): RoadNode | null {
  let acc = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    if (!a || !b) continue;
    const seg = Math.hypot(b.x - a.x, b.z - a.z);
    if (acc + seg >= d) {
      const t = (d - acc) / seg;
      return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
    }
    acc += seg;
  }
  return null;
}

function dirAtRadius(pts: readonly RoadNode[], d: number): number {
  let acc = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    if (!a || !b) continue;
    const seg = Math.hypot(b.x - a.x, b.z - a.z);
    if (acc + seg >= d) return Math.atan2(b.z - a.z, b.x - a.x);
    acc += seg;
  }
  const a = pts[pts.length - 2];
  const b = pts[pts.length - 1];
  if (a && b) return Math.atan2(b.z - a.z, b.x - a.x);
  return 0;
}

function rotOffset(cx: number, cz: number, localX: number, localZ: number, rot: number): RoadNode {
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  return { x: cx + localX * cos - localZ * sin, z: cz + localX * sin + localZ * cos };
}

function centroid(poly: readonly RoadNode[]): RoadNode {
  let x = 0;
  let z = 0;
  for (const p of poly) {
    x += p.x;
    z += p.z;
  }
  const n = Math.max(1, poly.length);
  return { x: x / n, z: z / n };
}
