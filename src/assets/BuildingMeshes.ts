/**
 * Procedural Normandy buildings: church with steeple, stone/brick
 * townhouses, farmhouses, barns and sheds — with real recessed window and
 * door openings, framed shutters, tiled gable roofs, chimneys, and three
 * damage states (intact / damaged / ruined) with charring and rubble.
 */

import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  Group,
  Mesh,
  MeshStandardMaterial,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Rng } from '../core/Random.ts';
import { detailedMaterial } from '../render/MaterialDetail.ts';
import type { MeshStandardNodeMaterial } from 'three/webgpu';
import type { BuildingSpec, WorldModel } from '../world/WorldTypes.ts';
import type { Ground } from '../world/Ground.ts';

// ---------------------------------------------------------------- palette

const MAT_MASONRY = detailedMaterial('masonry', { roughness: 0.94 });
const MAT_ROOF = detailedMaterial('roof', { roughness: 0.88 });
const MAT_WOOD = detailedMaterial('wood', { roughness: 0.85 });
const MAT_DARK = new MeshStandardMaterial({ color: new Color(0.045, 0.04, 0.035), roughness: 1, metalness: 0 });

// Normandy palette: warm cream limestone dominant (matches references), pale
// lime plaster, a muted red brick for the occasional townhouse, terracotta tile.
const STONE = new Color(0.72, 0.67, 0.54);
const PLASTER = new Color(0.79, 0.74, 0.63);
// French-street render tints — r−g kept ≤0.05 (brick-mask contract) and
// g>0.5 (colombage gate treats them as plaster/stone finishes)
const RENDER_OCHRE = new Color(0.76, 0.72, 0.56);
const RENDER_GREY = new Color(0.68, 0.66, 0.61);
const BRICK = new Color(0.52, 0.36, 0.3);
const TILE_TERRACOTTA = new Color(0.44, 0.28, 0.2); // weathered — bright orange reads toy-like
const TILE_SLATE = new Color(0.32, 0.33, 0.36);
const WOOD_W = new Color(0.4, 0.33, 0.25);
const CHAR = new Color(0.1, 0.09, 0.08);

// --------------------------------------------------------------- helpers

/** Push a colored, jittered box into an accumulator list. */
function box(
  acc: BufferGeometry[],
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
  color: Color,
  rng: Rng,
  opts: { jitter?: number; mottle?: number; rotY?: number; char?: number } = {},
): void {
  const g = new BoxGeometry(w, h, d);
  const jitter = opts.jitter ?? 0;
  const mottle = opts.mottle ?? 0.08;
  const pos = g.attributes['position'];
  if (!pos) return;
  const colors = new Float32Array(pos.count * 3);
  const c = new Color();
  for (let i = 0; i < pos.count; i++) {
    if (jitter > 0) {
      pos.setXYZ(
        i,
        pos.getX(i) + rng.range(-jitter, jitter),
        pos.getY(i) + rng.range(-jitter, jitter),
        pos.getZ(i) + rng.range(-jitter, jitter),
      );
    }
    c.copy(color).multiplyScalar(1 + rng.range(-mottle, mottle));
    if (opts.char !== undefined && opts.char > 0) c.lerp(CHAR, opts.char * rng.range(0.5, 1));
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new BufferAttribute(colors, 3));
  if (opts.rotY) g.rotateY(opts.rotY);
  g.translate(x, y, z);
  // merge pool mixes custom non-indexed geometry (gables, spire) — normalize
  acc.push(g.toNonIndexed());
  g.dispose();
}

function transformNew(list: BufferGeometry[], start: number, transform: (geometry: BufferGeometry) => void): void {
  for (let i = start; i < list.length; i++) {
    const geometry = list[i];
    if (geometry) transform(geometry);
  }
}

/** Gable-end triangle fill (two triangles, both faces). */
function gableTri(acc: BufferGeometry[], width: number, rise: number, x: number, y: number, z: number, color: Color, rng: Rng): void {
  const hw = width / 2;
  const verts = new Float32Array([
    // front face
    -hw, 0, 0, hw, 0, 0, 0, rise, 0,
    // back face (reversed winding)
    hw, 0, 0, -hw, 0, 0, 0, rise, 0,
  ]);
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(verts, 3));
  const colors = new Float32Array(6 * 3);
  const c = new Color();
  for (let i = 0; i < 6; i++) {
    c.copy(color).multiplyScalar(1 + rng.range(-0.08, 0.08));
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new BufferAttribute(colors, 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array(6 * 2), 2));
  g.computeVertexNormals();
  g.translate(x, y, z);
  acc.push(g);
}

interface WallOpening {
  /** Position along the wall (centered at 0). */
  u: number;
  width: number;
  sill: number;
  head: number;
  door: boolean;
}

/**
 * Wall with real openings: masonry pieces around each opening, plus frames,
 * dark glass insets and shutters pushed to the wood/glass accumulators.
 */
function wallWithOpenings(
  masonry: BufferGeometry[],
  wood: BufferGeometry[],
  length: number,
  height: number,
  thickness: number,
  openings: WallOpening[],
  wallColor: Color,
  shutterColor: Color,
  rng: Rng,
  charAmount: number,
): void {
  const sorted = [...openings].sort((a, b) => a.u - b.u);
  let cursor = -length / 2;
  const t = thickness;
  const push = (u0: number, u1: number, y0: number, y1: number): void => {
    const w = u1 - u0;
    const h = y1 - y0;
    if (w < 0.04 || h < 0.04) return;
    box(masonry, w, h, t, (u0 + u1) / 2, (y0 + y1) / 2, 0, wallColor, rng, {
      jitter: 0.012,
      char: charAmount,
    });
  };
  for (const o of sorted) {
    const left = o.u - o.width / 2;
    const right = o.u + o.width / 2;
    // full-height pier before the opening
    push(cursor, left, 0, height);
    // below sill / above head
    if (!o.door && o.sill > 0.05) push(left, right, 0, o.sill);
    push(left, right, o.head, height);
    // frame + glass/door + shutters. Painted cream/stone surround so the
    // window reads against the wall (Normandy windows have light surrounds).
    const frameC = new Color(0.8, 0.77, 0.69).multiplyScalar(rng.range(0.9, 1.08));
    const fw = 0.08;
    const oh = o.head - (o.door ? 0 : o.sill);
    const oy = (o.door ? 0 : o.sill) + oh / 2;
    // lintel + jambs (slightly proud of the wall)
    box(wood, o.width + fw * 2, fw, t * 1.15, o.u, o.head + fw / 2, 0, frameC, rng, {});
    box(wood, fw, oh, t * 1.15, left - fw / 2, oy, 0, frameC, rng, {});
    box(wood, fw, oh, t * 1.15, right + fw / 2, oy, 0, frameC, rng, {});
    if (o.door) {
      const doorC = new Color().copy(shutterColor).multiplyScalar(rng.range(0.55, 0.8));
      const doorZ = t * 0.48;
      box(wood, o.width, oh, 0.06, o.u, oy, doorZ, doorC, rng, { mottle: 0.12 });
      const panelC = new Color().copy(doorC).multiplyScalar(0.72);
      for (const sx of [-1, 1]) {
        box(wood, 0.055, oh * 0.82, 0.035, o.u + sx * o.width * 0.31, oy, doorZ + 0.045, panelC, rng, { mottle: 0.08 });
      }
      for (const sy of [-0.28, 0.04, 0.34]) {
        box(wood, o.width * 0.72, 0.055, 0.035, o.u, oy + sy * oh, doorZ + 0.045, panelC, rng, { mottle: 0.08 });
      }
    } else {
      box(wood, o.width, fw, t * 1.15, o.u, o.sill - fw / 2, 0, frameC, rng, {}); // sill
      // glass inset: dark but with a cool sky-reflected tint (not pure black)
      box(wood, o.width * 0.92, oh * 0.92, 0.03, o.u, oy, t * 0.08, new Color(0.045, 0.075, 0.1), rng, { mottle: 0.2 });
      // cross mullion
      box(wood, 0.04, oh * 0.9, 0.05, o.u, oy, t * 0.16, frameC, rng, {});
      box(wood, o.width * 0.9, 0.04, 0.05, o.u, oy, t * 0.16, frameC, rng, {});
      // shutters (some open, some closed-looking = flush against wall sides)
      if (rng.chance(0.8)) {
        const sc = new Color().copy(shutterColor).multiplyScalar(rng.range(0.8, 1.15));
        const sw = o.width * 0.5;
        const shutterZ = t * 0.72;
        const slatC = new Color().copy(sc).multiplyScalar(0.68);
        const addShutter = (x: number): void => {
          box(wood, sw, oh, 0.045, x, oy, shutterZ, sc, rng, { mottle: 0.15 });
          for (const sy of [-0.3, -0.1, 0.1, 0.3]) {
            box(wood, sw * 0.82, 0.035, 0.035, x, oy + sy * oh, shutterZ + 0.04, slatC, rng, { mottle: 0.08 });
          }
        };
        addShutter(left - sw / 2 - fw);
        if (rng.chance(0.85)) addShutter(right + sw / 2 + fw);
      }
    }
    cursor = right;
  }
  push(cursor, length / 2, 0, height);
}

/** Tiled gable roof: two slopes of overlapping row slabs + ridge + optional damage hole. */
function gableRoof(
  roof: BufferGeometry[],
  wood: BufferGeometry[],
  width: number, // along the ridge
  depth: number, // eave-to-eave span
  baseY: number,
  rise: number,
  tileColor: Color,
  rng: Rng,
  damage: { holeU0: number; holeU1: number; side: number } | null,
  charAmount: number,
  // per-end ridge-direction overhang: party-wall ends of a rowhouse must not
  // cantilever tiles over the neighbour (default = detached 0.38 both ends)
  ends: { neg?: number; pos?: number } = {},
): void {
  const rows = 9;
  const overhang = 0.38;
  const ovNeg = ends.neg ?? overhang;
  const ovPos = ends.pos ?? overhang;
  const rowW = width + ovNeg + ovPos;
  const rowX = (ovPos - ovNeg) / 2;
  const slopeLen = Math.hypot(depth / 2 + overhang, rise);
  const pitch = Math.atan2(rise, depth / 2 + overhang);
  for (const side of [-1, 1]) {
    for (let r = 0; r < rows; r++) {
      const t0 = r / rows;
      const rowLen = slopeLen / rows + 0.06;
      // center of this row along the slope
      const s = (t0 + 0.5 / rows) * slopeLen;
      const y = baseY + Math.sin(pitch) * (slopeLen - s);
      const z = side * Math.cos(pitch) * s - side * 0.0;
      // skip rows inside the damage hole
      if (damage && side === damage.side && t0 > damage.holeU0 && t0 < damage.holeU1) {
        // charred rafters instead
        if (r % 2 === 0) {
          for (let b = -2; b <= 2; b++) {
            box(wood, 0.09, 0.12, rowLen, (b / 5) * width * 0.8, y - 0.05, z, CHAR, rng, { mottle: 0.3 });
          }
        }
        continue;
      }
      const rowC = new Color().copy(tileColor).multiplyScalar(1 + rng.range(-0.13, 0.13));
      const g = new BoxGeometry(rowW, 0.055, rowLen);
      const pos = g.attributes['position'];
      if (pos) {
        const colors = new Float32Array(pos.count * 3);
        const c = new Color();
        for (let i = 0; i < pos.count; i++) {
          c.copy(rowC).multiplyScalar(1 + rng.range(-0.06, 0.06));
          if (charAmount > 0) c.lerp(CHAR, charAmount * rng.range(0.3, 1));
          colors[i * 3] = c.r;
          colors[i * 3 + 1] = c.g;
          colors[i * 3 + 2] = c.b;
        }
        g.setAttribute('color', new BufferAttribute(colors, 3));
      }
      g.rotateX(side > 0 ? pitch : -pitch);
      g.translate(rowX, y, z);
      roof.push(g.toNonIndexed());
      g.dispose();
    }
  }
  // ridge caps
  const caps = Math.max(3, Math.round(width / 0.5));
  for (let i = 0; i < caps; i++) {
    const u = -width / 2 + (i + 0.5) * (width / caps);
    box(roof, width / caps + 0.03, 0.09, 0.24, u, baseY + rise + 0.04, 0, new Color().copy(tileColor).multiplyScalar(0.9 + rng.float() * 0.2), rng, {});
  }
}

// ---------------------------------------------------------------- houses

function buildHouse(spec: BuildingSpec): Group {
  const rng = new Rng(spec.seed);
  const masonry: BufferGeometry[] = [];
  const roof: BufferGeometry[] = [];
  const wood: BufferGeometry[] = [];

  const W = spec.halfW * 2;
  const D = spec.halfD * 2;
  const H = spec.wallHeight;
  const ruined = spec.damage === 'ruined';
  const damaged = spec.damage === 'damaged';
  const charAmount = ruined ? 0.5 : damaged ? 0.18 : 0;

  const isBrick = spec.kind === 'townhouse-brick';
  const isBarn = spec.kind === 'barn';
  const isShed = spec.kind === 'shed';
  const partyNeg = spec.partyNegX === true;
  const partyPos = spec.partyPosX === true;
  const isRow = partyNeg || partyPos;
  // Limestone-dominant village (matches references): only a minority of the
  // "brick" townhouses stay red brick; barns are mostly stone with some
  // timber. Townhouse renders draw from a French-street palette — cream,
  // limestone, pale ochre, warm grey — all inside the brick-mask contract
  // (r−g small) so the facade shader keeps plaster coursing, never brick.
  const wallC = new Color().copy(
    isBrick && spec.seed % 5 < 2
      ? BRICK
      : spec.kind === 'farmhouse'
        ? PLASTER
        : rng.pick([STONE, PLASTER, RENDER_OCHRE, RENDER_GREY, STONE]),
  );
  if (spec.kind === 'farmhouse' && rng.chance(0.5)) wallC.copy(STONE);
  if (isBarn || isShed) {
    if (spec.seed % 3 === 0) wallC.copy(WOOD_W).multiplyScalar(rng.range(0.85, 1.05));
    else wallC.copy(STONE).multiplyScalar(rng.range(0.92, 1.06));
  }
  wallC.multiplyScalar(rng.range(0.9, 1.1));
  const shutterC = rng.pick([
    new Color(0.28, 0.36, 0.3),
    new Color(0.3, 0.34, 0.42),
    new Color(0.45, 0.36, 0.26),
    new Color(0.5, 0.48, 0.42),
    new Color(0.38, 0.24, 0.2), // oxblood
    new Color(0.2, 0.28, 0.23), // dark chasse green
  ]);
  const tileC = new Color().copy(isBarn || isShed ? TILE_SLATE : rng.chance(0.55) ? TILE_TERRACOTTA : TILE_SLATE);

  const t = 0.34; // wall thickness

  // shopfront layout (decided once so the fascia board aligns with the pane)
  const shop = spec.shop === true && !isBarn && !isShed;
  const shopW = Math.min(2.9, W * 0.44);
  const shopU = -W * 0.14;
  const shopDoorU = W * 0.5 - Math.max(0.9, W * 0.18);

  // ---- openings per facade
  const facadeOpenings = (len: number, floors: number, withDoor: boolean, isShopFront = false): WallOpening[] => {
    const out: WallOpening[] = [];
    const n = Math.max(1, Math.floor(len / 2.6));
    for (let f = 0; f < floors; f++) {
      const sill = f * (H / floors) + (f === 0 ? 0.95 : 0.8);
      const head = f * (H / floors) + (H / floors) * (f === 0 ? 0.78 : 0.72) + (f === 0 ? 0.4 : 0.45);
      if (f === 0 && isShopFront) {
        // wide display pane + door tucked at the run side — the French
        // ground-floor commerce read; upper floors stay domestic
        out.push({ u: shopU, width: shopW, sill: 0.3, head: 2.45, door: false });
        out.push({ u: shopDoorU, width: 1.0, sill: 0, head: 2.3, door: true });
        continue;
      }
      for (let i = 0; i < n; i++) {
        const u = -len / 2 + ((i + 0.5) / n) * len + rng.range(-0.1, 0.1);
        if (withDoor && f === 0 && i === Math.floor(n / 2)) {
          out.push({ u, width: 1.05, sill: 0, head: 2.15, door: true });
        } else {
          out.push({ u, width: isBarn ? 0.9 : 0.95, sill, head: Math.min(head, H - 0.25), door: false });
        }
      }
    }
    return out;
  };

  const floors = spec.floors;
  if (isBarn) {
    // barn: big double door on gable end, tiny loft window
    const front: WallOpening[] = [{ u: 0, width: 2.6, sill: 0, head: 3.0, door: true }];
    const side: WallOpening[] = [{ u: -W * 0.22, width: 0.7, sill: 1.4, head: 2.1, door: false }];
    const g1: BufferGeometry[] = [];
    let woodStart = wood.length;
    wallWithOpenings(g1, wood, D, H, t, front, wallC, shutterC, rng, charAmount);
    const placeG1 = (g: BufferGeometry): void => { g.rotateY(Math.PI / 2); g.translate(-W / 2 + t / 2, 0, 0); };
    for (const g of g1) placeG1(g);
    transformNew(wood, woodStart, placeG1);
    masonry.push(...g1);
    const g2: BufferGeometry[] = [];
    woodStart = wood.length;
    wallWithOpenings(g2, wood, D, H, t, [], wallC, shutterC, rng, charAmount);
    const placeG2 = (g: BufferGeometry): void => { g.rotateY(Math.PI / 2); g.translate(W / 2 - t / 2, 0, 0); };
    for (const g of g2) placeG2(g);
    transformNew(wood, woodStart, placeG2);
    masonry.push(...g2);
    const g3: BufferGeometry[] = [];
    woodStart = wood.length;
    wallWithOpenings(g3, wood, W, H, t, side, wallC, shutterC, rng, charAmount);
    const placeG3 = (g: BufferGeometry): void => { g.translate(0, 0, -D / 2 + t / 2); };
    for (const g of g3) placeG3(g);
    transformNew(wood, woodStart, placeG3);
    masonry.push(...g3);
    const g4: BufferGeometry[] = [];
    woodStart = wood.length;
    wallWithOpenings(g4, wood, W, H, t, [], wallC, shutterC, rng, charAmount);
    const placeG4 = (g: BufferGeometry): void => { g.translate(0, 0, D / 2 - t / 2); };
    for (const g of g4) placeG4(g);
    transformNew(wood, woodStart, placeG4);
    masonry.push(...g4);
  } else {
    // front (+Z local), back, two gable ends
    const front: BufferGeometry[] = [];
    let woodStart = wood.length;
    wallWithOpenings(front, wood, W, H, t, facadeOpenings(W, floors, !isShed && !shop, shop), wallC, shutterC, rng, charAmount);
    const placeFront = (g: BufferGeometry): void => { g.translate(0, 0, D / 2 - t / 2); };
    for (const g of front) placeFront(g);
    transformNew(wood, woodStart, placeFront);
    masonry.push(...front);
    const back: BufferGeometry[] = [];
    woodStart = wood.length;
    wallWithOpenings(back, wood, W, H, t, isShed ? [] : facadeOpenings(W, floors, false), wallC, shutterC, rng, charAmount);
    const placeBack = (g: BufferGeometry): void => { g.rotateY(Math.PI); g.translate(0, 0, -D / 2 + t / 2); };
    for (const g of back) placeBack(g);
    transformNew(wood, woodStart, placeBack);
    masonry.push(...back);
    for (const side of [-1, 1]) {
      const end: BufferGeometry[] = [];
      // gable ends: one window PER FLOOR (the old slice() bunched them all
      // on the ground floor, leaving tall blank uppers) — party walls stay
      // sealed, and some free ends stay blind (pignon aveugle, very French)
      const isParty = side === 1 ? partyPos : partyNeg;
      const blind = isShed || isParty || rng.chance(0.3);
      const endOpen: WallOpening[] = [];
      if (!blind) {
        const perFloor = D > 8.5 ? 2 : 1;
        for (let f = 0; f < floors; f++) {
          const sill = f * (H / floors) + (f === 0 ? 0.95 : 0.8);
          const head = Math.min(
            f * (H / floors) + (H / floors) * (f === 0 ? 0.78 : 0.72) + (f === 0 ? 0.4 : 0.45),
            H - 0.25,
          );
          for (let i = 0; i < perFloor; i++) {
            const u = perFloor === 1 ? rng.range(-0.6, 0.6) : (i === 0 ? -1 : 1) * D * 0.18 + rng.range(-0.15, 0.15);
            endOpen.push({ u, width: 0.9, sill, head, door: false });
          }
        }
      }
      woodStart = wood.length;
      wallWithOpenings(end, wood, D, H, t, endOpen, wallC, shutterC, rng, charAmount);
      const placeEnd = (g: BufferGeometry): void => { g.rotateY((Math.PI / 2) * side); g.translate((W / 2 - t / 2) * side, 0, 0); };
      for (const g of end) placeEnd(g);
      transformNew(wood, woodStart, placeEnd);
      masonry.push(...end);
    }
    // string courses: a thin proud band at every floor line on street/back
    // facades — the horizontal articulation French rowhouses live by.
    // (Wall piers span to ±t/2 around the wall centre at D/2−t/2, so the
    // exterior plane is exactly D/2 — bands must sit BEYOND it to show.)
    if (!ruined && floors >= 2 && !isShed) {
      const bandC = new Color().copy(wallC).multiplyScalar(1.14);
      for (let f = 1; f < floors; f++) {
        const by = f * (H / floors) + 0.32;
        for (const zs of [1, -1]) {
          box(masonry, W - 0.1, 0.14, 0.08, 0, by, zs * (D / 2 + 0.02), bandC, rng, { jitter: 0.006, char: charAmount });
        }
      }
    }
    // shopfront fascia: painted signboard spanning the display pane
    if (shop && !ruined) {
      const fasciaC = rng.pick([
        new Color(0.14, 0.19, 0.15),
        new Color(0.28, 0.14, 0.12),
        new Color(0.15, 0.17, 0.22),
      ]);
      box(wood, shopW + 1.4, 0.44, 0.09, shopU, 2.72, D / 2 + 0.03, fasciaC, rng, { mottle: 0.08, char: charAmount });
    }
  }

  // dark interior blocker
  box(masonry, W - t * 2.2, ruined ? H * 0.4 : H, D - t * 2.2, 0, (ruined ? H * 0.4 : H) / 2, 0, new Color(0.05, 0.045, 0.04), rng, { mottle: 0.1 });

  // facade relief — quoins: alternating proud corner blocks on masonry
  // (party-wall corners are shared with the neighbour — no quoins there)
  if (!isBarn && !isShed && !ruined) {
    const quoinC = new Color().copy(wallC).multiplyScalar(1.18);
    for (const [cxs, czs] of [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ] as const) {
      if ((cxs === 1 && partyPos) || (cxs === -1 && partyNeg)) continue;
      const courses = Math.floor(H / 0.42);
      for (let q = 0; q < courses; q++) {
        const big = q % 2 === 0;
        box(
          masonry,
          big ? 0.42 : 0.3,
          0.34,
          big ? 0.3 : 0.42,
          cxs * (W / 2 - 0.08),
          0.21 + q * 0.42,
          czs * (D / 2 - 0.08),
          quoinC,
          rng,
          { jitter: 0.012, char: charAmount },
        );
      }
    }
  }

  // Norman colombage: dark timber framing on plaster facades. Street rows
  // use it sparingly (most French town frontage is smooth render), and a
  // shopfront never gets posts striping across its display pane.
  const isPlasterFacade = !isBrick && !isBarn && !isShed && wallC.g > 0.5;
  if (isPlasterFacade && !ruined && rng.chance(isRow ? 0.3 : 0.75)) {
    const timberC = new Color(0.21, 0.16, 0.11);
    for (const side of shop ? [-1] : [-1, 1]) {
      // beyond the exterior plane at ±D/2 (the old −t/2+0.035 offset left
      // the timbers entombed 11 cm INSIDE the piers — never visible)
      const zOff = (D / 2 + 0.025) * side;
      const nPosts = Math.max(3, Math.floor(W / 1.4));
      for (let i = 0; i <= nPosts; i++) {
        const u = -W / 2 + (i / nPosts) * W;
        box(wood, 0.12, H - 0.2, 0.05, u, H / 2, zOff, timberC, rng, { mottle: 0.12 });
      }
      // horizontal rails between the posts
      for (const hy of [H * 0.32, H * 0.66]) {
        box(wood, W - 0.15, 0.11, 0.05, 0, hy, zOff, timberC, rng, { mottle: 0.12 });
      }
    }
  }

  const rise = (isBarn ? 0.62 : 0.52) * D;
  if (!ruined) {
    // gable end triangles. Build at the origin and place ONLY via the
    // post-rotation translate: passing the x-offset into gableTri baked it
    // in BEFORE rotateY, which converted it into a sideways Z displacement —
    // every house's −X gable sat half a house off-axis, poking through the
    // roof slope (finally obvious on the tall 3-story rowhouses).
    gableTri(masonry, D, rise, 0, H, 0, wallC, rng);
    if (masonry.length > 0) {
      const gable = masonry[masonry.length - 1];
      if (gable) gable.rotateY(Math.PI / 2), gable.translate(-W / 2 + t / 2, 0, 0);
    }
    gableTri(masonry, D, rise, 0, H, 0, wallC, rng);
    {
      const gable = masonry[masonry.length - 1];
      if (gable) gable.rotateY(-Math.PI / 2), gable.translate(W / 2 - t / 2, 0, 0);
    }
    // roof — damaged: hole on one slope; party ends keep tiles off the
    // neighbour so stepped rooflines break cleanly at the shared wall
    const dmg = damaged
      ? { holeU0: rng.range(0.15, 0.35), holeU1: rng.range(0.55, 0.8), side: rng.chance(0.5) ? 1 : -1 }
      : null;
    const roofRot: BufferGeometry[] = [];
    gableRoof(roofRot, wood, W, D, H, rise, tileC, rng, dmg, charAmount, {
      ...(partyNeg ? { neg: 0.05 } : {}),
      ...(partyPos ? { pos: 0.05 } : {}),
    });
    // roof rows were built with ridge along X — matches house (ridge along local X)
    roof.push(...roofRot);
    // dormers on the street slope: the attic-floor read of French rowhouses
    // (skipped when the damage hole is on this slope — no floating dormers)
    if (!isShed && !isBarn && floors >= 2 && !(dmg && dmg.side === 1) && rng.chance(isRow ? 0.7 : 0.4)) {
      const overhang = 0.38;
      const slopeLen = Math.hypot(D / 2 + overhang, rise);
      const pitch = Math.atan2(rise, D / 2 + overhang);
      const nDorm = W > 7.4 && rng.chance(0.6) ? 2 : 1;
      for (let dIdx = 0; dIdx < nDorm; dIdx++) {
        const xd = nDorm === 1 ? rng.range(-W * 0.18, W * 0.18) : (dIdx === 0 ? -1 : 1) * W * rng.range(0.18, 0.26);
        const sAlong = slopeLen * rng.range(0.5, 0.62);
        const ySurf = H + Math.sin(pitch) * (slopeLen - sAlong);
        const zSurf = Math.cos(pitch) * sAlong;
        // cheeked face with a small pane, capped by two tile slabs
        box(masonry, 0.98, 1.2, 0.12, xd, ySurf + 0.48, zSurf + 0.1, wallC, rng, { jitter: 0.008, char: charAmount });
        box(wood, 0.52, 0.66, 0.05, xd, ySurf + 0.52, zSurf + 0.17, new Color(0.1, 0.13, 0.17), rng, { mottle: 0.3 });
        box(wood, 0.66, 0.08, 0.06, xd, ySurf + 0.92, zSurf + 0.18, new Color(0.8, 0.77, 0.69), rng, {});
        for (const rs of [-1, 1]) {
          const slab = new BoxGeometry(1.16, 0.05, 0.78);
          slab.rotateX(-pitch * 0.55);
          // negative sign: outer edge tilts DOWN so the pair peaks (Λ, not V)
          slab.rotateZ(-rs * 0.62);
          slab.translate(xd + rs * 0.3, ySurf + 1.22, zSurf - 0.02);
          const posAttr = slab.getAttribute('position');
          const cols = new Float32Array(posAttr.count * 3);
          const cc = new Color();
          for (let vi = 0; vi < posAttr.count; vi++) {
            cc.copy(tileC).multiplyScalar(1 + rng.range(-0.1, 0.1));
            if (charAmount > 0) cc.lerp(CHAR, charAmount * rng.range(0.3, 1));
            cols[vi * 3] = cc.r;
            cols[vi * 3 + 1] = cc.g;
            cols[vi * 3 + 2] = cc.b;
          }
          slab.setAttribute('color', new BufferAttribute(cols, 3));
          roof.push(slab.toNonIndexed());
          slab.dispose();
        }
      }
    }
    // chimney: a solid stack from the roof up to ~1.1 m proud of the ridge,
    // with the cap sitting ON the stack top. Rowhouses stack theirs on the
    // party wall — the classic shared-flue silhouette.
    if (!isShed && !isBarn) {
      const partySide = partyPos && partyNeg ? (rng.chance(0.5) ? 1 : -1) : partyPos ? 1 : partyNeg ? -1 : 0;
      const cx = partySide !== 0 ? partySide * (W / 2 - 0.42) : rng.range(-W * 0.3, W * 0.3);
      const chTop = H + rise + 1.1;
      const chBot = H + 0.3;
      const chH = chTop - chBot;
      box(masonry, 0.6, chH, 0.6, cx, (chTop + chBot) / 2, 0, new Color().copy(isBrick ? BRICK : STONE).multiplyScalar(0.9), rng, { jitter: 0.01, char: charAmount });
      box(masonry, 0.82, 0.18, 0.82, cx, chTop + 0.06, 0, new Color(0.38, 0.36, 0.32), rng, {});
    }
  } else {
    // ruined: jagged toppled blocks along the broken wall tops
    for (let i = 0; i < 14; i++) {
      box(
        masonry,
        rng.range(0.25, 0.6),
        rng.range(0.15, 0.4),
        rng.range(0.25, 0.6),
        rng.range(-W / 2, W / 2),
        H * rng.range(0.28, 0.5),
        rng.chance(0.5) ? -D / 2 + t / 2 : D / 2 - t / 2,
        wallC,
        rng,
        { jitter: 0.06, char: 0.4 },
      );
    }
    // interior rubble mound
    for (let i = 0; i < 22; i++) {
      const rx = rng.range(-W * 0.35, W * 0.35);
      const rz = rng.range(-D * 0.35, D * 0.35);
      box(
        masonry,
        rng.range(0.3, 0.8),
        rng.range(0.15, 0.45),
        rng.range(0.3, 0.8),
        rx,
        0.2 + rng.float() * 0.5 * (1 - Math.hypot(rx / W, rz / D)),
        rz,
        rng.chance(0.5) ? wallC : new Color().copy(isBrick ? BRICK : PLASTER),
        rng,
        { jitter: 0.07, char: 0.35 },
      );
    }
  }

  // ruined walls: crop height — rebuild masonry pieces above break line is complex;
  // instead we scale wall pieces' Y via a post-pass on merged geometry (cheap visual read):
  const group = new Group();
  const addMerged = (list: BufferGeometry[], mat: MeshStandardMaterial | MeshStandardNodeMaterial): void => {
    if (list.length === 0) return;
    const merged = mergeGeometries(list, false);
    if (!merged) return;
    if (ruined && (mat as unknown) === (MAT_MASONRY as unknown)) {
      // clamp vertices above the break height with jitter → jagged broken tops
      const pos = merged.attributes['position'];
      if (pos) {
        for (let i = 0; i < pos.count; i++) {
          const y = pos.getY(i);
          const x = pos.getX(i);
          const z = pos.getZ(i);
          const breakH = H * (0.32 + 0.35 * Math.abs(Math.sin(x * 2.7 + z * 1.9 + spec.seed)));
          if (y > breakH) pos.setY(i, breakH + (Math.sin(x * 12.3 + z * 9.1) + 1) * 0.08);
        }
        pos.needsUpdate = true;
      }
    }
    merged.computeVertexNormals();
    const mesh = new Mesh(merged, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    for (const g of list) g.dispose();
  };
  addMerged(masonry, MAT_MASONRY);
  addMerged(roof, MAT_ROOF);
  addMerged(wood, MAT_WOOD);
  return group;
}

// ---------------------------------------------------------------- church

function buildChurch(spec: BuildingSpec): Group {
  const rng = new Rng(spec.seed);
  const masonry: BufferGeometry[] = [];
  const roof: BufferGeometry[] = [];
  const wood: BufferGeometry[] = [];

  const W = spec.halfW * 2; // nave width
  const D = spec.halfD * 2; // nave length (local Z)
  const H = spec.wallHeight;
  const stone = new Color().copy(STONE).multiplyScalar(rng.range(0.95, 1.05));
  const charAmount = spec.damage === 'damaged' ? 0.14 : 0;

  const t = 0.5;
  // nave walls with tall arched-impression windows along the long sides
  for (const side of [-1, 1]) {
    const openings: WallOpening[] = [];
    const n = 4;
    for (let i = 0; i < n; i++) {
      openings.push({ u: -D / 2 + ((i + 0.5) / n) * D, width: 0.85, sill: 1.7, head: H - 1.1, door: false });
    }
    const list: BufferGeometry[] = [];
    const woodStart = wood.length;
    wallWithOpenings(list, wood, D, H, t, openings, stone, new Color(0.3, 0.3, 0.32), rng, charAmount);
    const placeSide = (g: BufferGeometry): void => { g.rotateY(Math.PI / 2); g.translate((W / 2 - t / 2) * side, 0, 0); };
    for (const g of list) placeSide(g);
    transformNew(wood, woodStart, placeSide);
    masonry.push(...list);
    // buttresses
    for (let i = 0; i <= n; i++) {
      const z = -D / 2 + (i / n) * D;
      box(masonry, 0.5, H * 0.82, 0.7, (W / 2 + 0.22) * side, H * 0.41, z, stone, rng, { jitter: 0.015 });
      box(masonry, 0.62, 0.18, 0.82, (W / 2 + 0.22) * side, H * 0.83, z, new Color().copy(stone).multiplyScalar(0.92), rng, {});
    }
  }
  // chancel end wall (rear)
  {
    const list: BufferGeometry[] = [];
    const woodStart = wood.length;
    wallWithOpenings(list, wood, W, H, t, [{ u: 0, width: 1.1, sill: 2.2, head: H - 0.9, door: false }], stone, new Color(0.3, 0.3, 0.32), rng, charAmount);
    const placeRear = (g: BufferGeometry): void => { g.rotateY(Math.PI); g.translate(0, 0, -D / 2 + t / 2); };
    for (const g of list) placeRear(g);
    transformNew(wood, woodStart, placeRear);
    masonry.push(...list);
  }
  box(masonry, W - t * 2, H, D - t * 2, 0, H / 2, 0, new Color(0.05, 0.045, 0.04), rng, { mottle: 0.08 });

  // nave roof (ridge along Z here → build with width=D then rotate 90°)
  const rise = 0.6 * W;
  const naveRoof: BufferGeometry[] = [];
  const dmg = spec.damage !== 'intact' ? { holeU0: 0.3, holeU1: 0.62, side: 1 } : null;
  gableRoof(naveRoof, wood, D, W, H, rise, TILE_SLATE, rng, dmg, charAmount);
  for (const g of naveRoof) g.rotateY(Math.PI / 2);
  roof.push(...naveRoof);
  gableTri(masonry, W, rise, 0, H, 0, stone, rng);
  {
    const gbl = masonry[masonry.length - 1];
    if (gbl) gbl.rotateY(Math.PI), gbl.translate(0, 0, -D / 2 + t / 2);
  }

  // steeple tower at the front (+Z), full width block rising high
  const TW = Math.min(W * 0.72, 4.6);
  const towerH = H * 2.55;
  const tz = D / 2 + TW / 2 - 0.2;
  // tower walls (four sides, door on front, louvered belfry openings up top)
  const towerWall = (len: number, rotY: number, ox: number, oz: number, openings: WallOpening[]): void => {
    const list: BufferGeometry[] = [];
    const woodStart = wood.length;
    wallWithOpenings(list, wood, len, towerH, 0.45, openings, stone, new Color(0.24, 0.22, 0.2), rng, charAmount);
    const placeTowerWall = (g: BufferGeometry): void => { g.rotateY(rotY); g.translate(ox, 0, oz); };
    for (const g of list) placeTowerWall(g);
    transformNew(wood, woodStart, placeTowerWall);
    masonry.push(...list);
  };
  towerWall(TW, 0, 0, tz + TW / 2 - 0.22, [
    { u: 0, width: 1.25, sill: 0, head: 2.6, door: true },
    { u: 0, width: 0.8, sill: towerH * 0.72, head: towerH * 0.9, door: false },
  ]);
  towerWall(TW, Math.PI, 0, tz - TW / 2 + 0.22, [{ u: 0, width: 0.8, sill: towerH * 0.72, head: towerH * 0.9, door: false }]);
  towerWall(TW, Math.PI / 2, -TW / 2 + 0.22, tz, [
    { u: 0, width: 0.7, sill: towerH * 0.45, head: towerH * 0.58, door: false },
    { u: 0, width: 0.8, sill: towerH * 0.72, head: towerH * 0.9, door: false },
  ]);
  towerWall(TW, -Math.PI / 2, TW / 2 - 0.22, tz, [
    { u: 0, width: 0.8, sill: towerH * 0.72, head: towerH * 0.9, door: false },
  ]);
  box(masonry, TW - 0.8, towerH, TW - 0.8, 0, towerH / 2, tz, new Color(0.05, 0.045, 0.04), rng, {});
  // cornice
  box(masonry, TW + 0.3, 0.22, TW + 0.3, 0, towerH + 0.08, tz, new Color().copy(stone).multiplyScalar(0.9), rng, {});

  // spire: tapered octagon (cone with 8 segments) + cross
  {
    const spireH = towerH * 0.85;
    const g = new BoxGeometry(1, 1, 1); // placeholder replaced below
    g.dispose();
    const spire = new BufferGeometry();
    const segs = 8;
    const baseR = TW * 0.62;
    const verts: number[] = [];
    for (let i = 0; i < segs; i++) {
      const a0 = (i / segs) * Math.PI * 2;
      const a1 = ((i + 1) / segs) * Math.PI * 2;
      verts.push(
        Math.cos(a0) * baseR, 0, Math.sin(a0) * baseR,
        Math.cos(a1) * baseR, 0, Math.sin(a1) * baseR,
        0, spireH, 0,
      );
    }
    spire.setAttribute('position', new BufferAttribute(new Float32Array(verts), 3));
    const colors = new Float32Array((verts.length / 3) * 3);
    const c = new Color();
    for (let i = 0; i < verts.length / 3; i++) {
      c.copy(TILE_SLATE).multiplyScalar(0.85 + rng.float() * 0.3);
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    spire.setAttribute('color', new BufferAttribute(colors, 3));
    spire.setAttribute('uv', new BufferAttribute(new Float32Array((verts.length / 3) * 2), 2));
    spire.computeVertexNormals();
    spire.translate(0, towerH + 0.18, tz);
    roof.push(spire);
    // cross
    box(wood, 0.08, 1.1, 0.08, 0, towerH + spireH + 0.75, tz, new Color(0.16, 0.15, 0.13), rng, {});
    box(wood, 0.55, 0.08, 0.08, 0, towerH + spireH + 0.98, tz, new Color(0.16, 0.15, 0.13), rng, {});
  }

  const group = new Group();
  const addMerged = (list: BufferGeometry[], mat: MeshStandardMaterial | MeshStandardNodeMaterial): void => {
    if (list.length === 0) return;
    const merged = mergeGeometries(list, false);
    if (!merged) return;
    merged.computeVertexNormals();
    const mesh = new Mesh(merged, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    for (const g of list) g.dispose();
  };
  addMerged(masonry, MAT_MASONRY);
  addMerged(roof, MAT_ROOF);
  addMerged(wood, MAT_WOOD);
  return group;
}

// ----------------------------------------------------------------- entry

export function buildBuilding(spec: BuildingSpec, ground: Ground): Group {
  const g = spec.kind === 'church' ? buildChurch(spec) : buildHouse(spec);
  // settle on terrain: min corner height, sunk slightly
  const cos = Math.cos(spec.rotation);
  const sin = Math.sin(spec.rotation);
  let minY = Infinity;
  for (const [lx, lz] of [
    [-spec.halfW, -spec.halfD],
    [spec.halfW, -spec.halfD],
    [spec.halfW, spec.halfD],
    [-spec.halfW, spec.halfD],
  ] as const) {
    const wx = spec.x + lx * cos - lz * sin;
    const wz = spec.z + lx * sin + lz * cos;
    minY = Math.min(minY, ground.height(wx, wz));
  }
  g.position.set(spec.x, minY - 0.15, spec.z);
  g.rotation.y = -spec.rotation;
  return g;
}

export function buildAllBuildings(model: WorldModel, ground: Ground): Group {
  const root = new Group();
  root.name = 'buildings';
  for (const spec of model.buildings) {
    root.add(buildBuilding(spec, ground));
  }
  // a dark foundation skirt hides slope gaps under every building
  return root;
}

export { MAT_DARK };
