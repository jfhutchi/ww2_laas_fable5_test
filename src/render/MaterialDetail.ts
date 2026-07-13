/**
 * Photoreal surface materials: CC0 photo textures (ambientCG, 1K JPG) layered
 * over the procedural macro/meso/micro detail law. Three node graphs per kind:
 *
 *  - colorNode: photo albedo normalized to a ~1.0-mean LINEAR multiplier
 *    (per-channel, from offline stats) so the existing vertex-color palette
 *    keeps ruling the grade, partially desaturated toward the muted-olive
 *    reference look, then multiplied by the procedural detail bands (they
 *    kill tiling) — NodeMaterial multiplies vertexColor/instanceColor in
 *    natively, so all existing painting keeps working.
 *  - normalNode: REAL relief from world-space finite differences of a total
 *    height field = procedural class structure (masonry coursing, plank
 *    grooves) + photo displacement maps, in meters. (The previous bumpMap()
 *    route was a silent no-op for pure-expression heights: BumpMapNode's
 *    UV-offset context only re-samples TextureNodes, so a procedural Fn
 *    yields a zero gradient. Differencing the height at ±ε world offsets
 *    makes both the procedural and the photo relief actually light.)
 *  - roughnessNode: photo roughness (mean-centered so the tuned base level
 *    holds) + micro variance so highlights never read plastic.
 *
 * Sampling is world-space (positionWorld) — no UV unwrapping anywhere:
 * ground kinds project on XZ, wall kinds triplanar on |normalWorld|⁸
 * weights. Where one merged mesh carries several surface classes, the class
 * is recovered from the painted vertex color (brick-red facades vs plaster,
 * terracotta vs slate roofs, cobbled vs dirt road) and used to blend photo
 * sets in-shader. Plain 2D sampled textures only — no 3D or storage
 * textures (SwiftShader CI, see TECHNICAL_NOTES.md).
 */

import { MeshStandardNodeMaterial } from 'three/webgpu';
import {
  Fn,
  abs,
  attribute,
  cameraViewMatrix,
  clamp,
  dot,
  float,
  floor,
  fract,
  luminance,
  max,
  mix,
  normalWorld,
  positionWorld,
  sin,
  smoothstep,
  texture as tslTexture,
  transformNormalToView,
  vec2,
  vec3,
  vec4,
  vertexColor,
} from 'three/tsl';
import { DoubleSide, RepeatWrapping, SRGBColorSpace, Texture, TextureLoader } from 'three';

type N2 = ReturnType<typeof vec2>;
type N3 = ReturnType<typeof vec3>;
type NF = ReturnType<typeof float>;

const hash12 = (p: N2): NF =>
  fract(sin(dot(p, vec2(127.1, 311.7))).mul(43758.5453)) as unknown as NF;

/** 2D value noise in [0,1), smooth interpolation. */
const vnoise = (p: N2): NF => {
  const i = floor(p);
  const f = fract(p);
  const u = f.mul(f).mul(f.mul(-2).add(3));
  const a = hash12(i as unknown as N2);
  const b = hash12(i.add(vec2(1, 0)) as unknown as N2);
  const c = hash12(i.add(vec2(0, 1)) as unknown as N2);
  const d = hash12(i.add(vec2(1, 1)) as unknown as N2);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y) as unknown as NF;
};

/** 3-octave fbm for richer height fields. */
const fbm = (p: N2): NF => {
  const a = vnoise(p);
  const b = vnoise(p.mul(2.03).add(11.7) as unknown as N2).mul(0.5);
  const c = vnoise(p.mul(4.01).add(37.1) as unknown as N2).mul(0.25);
  return a.add(b).add(c).div(1.75) as unknown as NF;
};

export type DetailKind =
  | 'terrain'
  | 'road'
  | 'masonry'
  | 'roof'
  | 'wood'
  | 'bark'
  | 'stone'
  | 'soil'
  | 'foliage'
  | 'grass'
  | 'metal'
  | 'armor'
  | 'tracks'
  | 'cloth';

export interface DetailOptions {
  roughness: number;
  metalness?: number;
  doubleSide?: boolean;
  /** Dust/mud accumulation strength (vehicle kinds), 0..1. */
  dust?: number;
  /** Local-space height (m) where dust has fully faded out. */
  dustHeight?: number;
}

// ---------------------------------------------------------------------------
// Photo-texture sets (ambientCG, CC0 — see docs/ASSETS.md). `norm` is the
// per-channel reciprocal of the albedo's mean LINEAR rgb (offline stats), so
// sample × norm is a hue-neutral multiplier with mean exactly 1.0 and the
// painted palette stays the boss. `satKeep` retains that fraction of the
// photo's local hue variation; `dispAmp` is the displacement span in meters.
// ---------------------------------------------------------------------------

interface PbrSet {
  asset: string;
  /** World meters covered by one texture repeat. */
  tile: number;
  norm: readonly [number, number, number];
  satKeep: number;
  /** Blend of the whole albedo layer toward flat 1.0 (JPG-noise softening). */
  strength: number;
  roughMean: number;
  roughInfluence: number;
  dispAmp: number;
}

const SETS = {
  grassA: { asset: 'Grass001', tile: 3.0, norm: [16.58, 9.17, 44.19], satKeep: 0.5, strength: 0.95, roughMean: 0.544, roughInfluence: 0.3, dispAmp: 0.035 },
  grassB: { asset: 'Grass004', tile: 3.4, norm: [7.88, 6.21, 29.15], satKeep: 0.5, strength: 0.95, roughMean: 0.263, roughInfluence: 0.3, dispAmp: 0.035 },
  soil: { asset: 'Ground048', tile: 2.6, norm: [9.54, 17.77, 26.49], satKeep: 0.7, strength: 1, roughMean: 0.669, roughInfluence: 0.4, dispAmp: 0.04 },
  gravel: { asset: 'Gravel022', tile: 2.2, norm: [4.42, 4.69, 5.78], satKeep: 0.65, strength: 1, roughMean: 0.463, roughInfluence: 0.4, dispAmp: 0.025 },
  setts: { asset: 'PavingStones128', tile: 2.0, norm: [2.77, 2.97, 3.6], satKeep: 0.8, strength: 1, roughMean: 0.527, roughInfluence: 0.5, dispAmp: 0.015 },
  plaster: { asset: 'PaintedPlaster017', tile: 2.5, norm: [1.94, 1.93, 2.02], satKeep: 0.8, strength: 1, roughMean: 0.515, roughInfluence: 0.5, dispAmp: 0.012 },
  brick: { asset: 'Bricks076C', tile: 1.4, norm: [10.2, 11.04, 16.72], satKeep: 0.6, strength: 1, roughMean: 0.712, roughInfluence: 0.5, dispAmp: 0.03 },
  rock: { asset: 'Rock023', tile: 2.4, norm: [3.65, 3.71, 3.86], satKeep: 0.8, strength: 1, roughMean: 0.611, roughInfluence: 0.5, dispAmp: 0.045 },
  terra: { asset: 'RoofingTiles012A', tile: 1.8, norm: [2.62, 8.48, 16.11], satKeep: 0.55, strength: 0.95, roughMean: 0.619, roughInfluence: 0.5, dispAmp: 0.022 },
  slate: { asset: 'RoofingTiles013A', tile: 1.8, norm: [31.75, 32.97, 27.47], satKeep: 0.6, strength: 0.85, roughMean: 0.5, roughInfluence: 0.4, dispAmp: 0.018 },
  bark: { asset: 'Bark012', tile: 1.6, norm: [3.8, 4.94, 11.1], satKeep: 0.8, strength: 1, roughMean: 0.674, roughInfluence: 0.4, dispAmp: 0.02 },
  // vehicle/figure kinds — sampled in LOCAL space so paint never swims as
  // the mesh drives around; relief output goes through transformNormalToView
  armor: { asset: 'Metal005', tile: 0.65, norm: [5.01, 5.28, 5.29], satKeep: 0.35, strength: 0.38, roughMean: 0.377, roughInfluence: 0.16, dispAmp: 0.0025 },
  tracks: { asset: 'Metal038', tile: 1.1, norm: [8.57, 8.27, 8.21], satKeep: 0.5, strength: 0.9, roughMean: 0.366, roughInfluence: 0.3, dispAmp: 0 },
  cloth: { asset: 'Fabric066', tile: 0.55, norm: [3.9, 4.14, 5.18], satKeep: 0.6, strength: 0.9, roughMean: 0.818, roughInfluence: 0.4, dispAmp: 0 },
} satisfies Record<string, PbrSet>;

type MapKind = 'Color' | 'Roughness' | 'Displacement';

const loader = new TextureLoader();
const texCache = new Map<string, Texture>();

function mapTex(set: PbrSet, map: MapKind): Texture {
  const url = `/textures/${set.asset}/${set.asset}_1K-JPG_${map}.jpg`;
  let t = texCache.get(url);
  if (!t) {
    t = loader.load(url);
    t.wrapS = RepeatWrapping;
    t.wrapT = RepeatWrapping;
    t.anisotropy = 8;
    if (map === 'Color') t.colorSpace = SRGBColorSpace;
    texCache.set(url, t);
  }
  return t;
}

// TSL @types are narrower than runtime — loose bridges (repo idiom).
type TexSample = { rgb: N3; r: NF };
const texAt = (t: Texture, uv: N2): TexSample =>
  (tslTexture as unknown as (tx: Texture, uv: N2) => TexSample)(t, uv);

// RAW geometry attributes: positionLocal/normalLocal are instance-transformed
// in this node setup (see GroundCover wind comment), which would make photo
// paint swim on moving InstancedMesh soldiers. Vehicle meshes are plain
// Meshes, where these equal positionLocal/normalLocal anyway.
const attrPos = (): N3 => (attribute as unknown as (n: string, t: string) => N3)('position', 'vec3');
const attrNrm = (): N3 => (attribute as unknown as (n: string, t: string) => N3)('normal', 'vec3');
const mat4mulV4 = (m: typeof cameraViewMatrix, v: ReturnType<typeof vec4>): ReturnType<typeof vec4> =>
  (m as unknown as { mul: (v: ReturnType<typeof vec4>) => ReturnType<typeof vec4> }).mul(v);

/** Planar XZ projection (ground kinds). */
const uvGround = (wp: N3, tile: number): N2 => vec2(wp.x, wp.z).div(tile) as unknown as N2;

interface TriWeights {
  wx: NF;
  wy: NF;
  wz: NF;
}

/** |normal|⁸ blend weights — sharp enough that most fragments are
 *  effectively single-plane, so photo patterns stay crisp. Local kinds
 *  weight by normalLocal so the projection sticks to the moving mesh. */
function triWeights(local: boolean): TriWeights {
  const nA = abs((local ? attrNrm() : (normalWorld.xyz as unknown as N3)) as unknown as N3) as unknown as N3;
  const n2 = nA.mul(nA);
  const n4 = n2.mul(n2);
  const n8 = n4.mul(n4);
  const sum = n8.x.add(n8.y).add(n8.z).max(1e-5);
  return { wx: n8.x.div(sum) as unknown as NF, wy: n8.y.div(sum) as unknown as NF, wz: n8.z.div(sum) as unknown as NF };
}

/** Triplanar scalar sample (Displacement / Roughness). */
function triScalar(t: Texture, wp: N3, tile: number, w: TriWeights): NF {
  const sX = texAt(t, vec2(wp.z, wp.y).div(tile) as unknown as N2).r;
  const sY = texAt(t, vec2(wp.x, wp.z).div(tile) as unknown as N2).r;
  const sZ = texAt(t, vec2(wp.x, wp.y).div(tile) as unknown as N2).r;
  return sX.mul(w.wx).add(sY.mul(w.wy)).add(sZ.mul(w.wz)) as unknown as NF;
}

/** Triplanar rgb sample (Color). */
function triRgb(t: Texture, wp: N3, tile: number, w: TriWeights): N3 {
  const sX = texAt(t, vec2(wp.z, wp.y).div(tile) as unknown as N2).rgb;
  const sY = texAt(t, vec2(wp.x, wp.z).div(tile) as unknown as N2).rgb;
  const sZ = texAt(t, vec2(wp.x, wp.y).div(tile) as unknown as N2).rgb;
  return sX.mul(w.wx).add(sY.mul(w.wy)).add(sZ.mul(w.wz)) as unknown as N3;
}

/** Normalize a raw albedo sample into a mean-1.0 multiplier around the
 *  painted palette: per-channel whitening, clamp against amplified JPG
 *  extremes, partial desaturation toward the muted reference grade. */
function albedoMul(set: PbrSet, sample: N3): N3 {
  let c = sample.mul(vec3(set.norm[0], set.norm[1], set.norm[2])) as unknown as N3;
  c = clamp(c, vec3(0.35, 0.35, 0.35), vec3(2.1, 2.1, 2.1)) as unknown as N3;
  const l = luminance(c as unknown as Parameters<typeof luminance>[0]) as unknown as NF;
  c = mix(vec3(l, l, l), c, set.satKeep) as unknown as N3;
  if (set.strength !== 1) c = mix(vec3(1, 1, 1), c, set.strength) as unknown as N3;
  return c;
}

/** Mean-centered roughness delta so the tuned base roughness holds. */
const roughDelta = (set: PbrSet, sample: NF): NF =>
  sample.sub(set.roughMean).mul(set.roughInfluence) as unknown as NF;

// Per-kind procedural relief amplitude (meters). 0 disables the normal work.
const PROC_AMP: Record<DetailKind, number> = {
  masonry: 0.022,
  stone: 0.012,
  roof: 0.002,
  wood: 0.007,
  bark: 0.004,
  road: 0.006,
  soil: 0.012,
  terrain: 0.01,
  grass: 0,
  foliage: 0,
  metal: 0.0025,
  armor: 0.004,
  tracks: 0.006,
  cloth: 0,
};

/** Kinds whose height field includes a photo displacement map. */
const HAS_DISP: ReadonlySet<DetailKind> = new Set<DetailKind>([
  'terrain', 'soil', 'road', 'masonry', 'roof', 'stone', 'bark', 'armor',
]);

/** Finite-difference step (m) — under the 1K texel size at our tile scales. */
const EPS = 0.0035;

export function detailedMaterial(kind: DetailKind, opts: DetailOptions): MeshStandardNodeMaterial {
  const mat = new MeshStandardNodeMaterial({
    roughness: opts.roughness,
    metalness: opts.metalness ?? 0,
  });
  mat.vertexColors = true;
  if (opts.doubleSide) mat.side = DoubleSide;

  const isGroundKind = kind === 'terrain' || kind === 'road' || kind === 'soil' || kind === 'grass';
  // vehicle/figure kinds sample in LOCAL space (mesh drives around the world)
  const isLocalKind = kind === 'armor' || kind === 'tracks' || kind === 'cloth';
  const hasPhoto =
    kind === 'terrain' || kind === 'road' || kind === 'masonry' || kind === 'roof' ||
    kind === 'stone' || kind === 'soil' || kind === 'grass' || kind === 'bark' ||
    isLocalKind;
  const dustAmt = opts.dust ?? 0;
  const dustH = opts.dustHeight ?? 1.2;

  // ---- surface-class masks recovered from the painted vertex color --------
  // (merged meshes carry several classes; the paint encodes which is which)
  const vc = vertexColor() as unknown as N3;
  const brickMask = smoothstep(0.08, 0.13, vc.r.sub(vc.g)) as unknown as NF; // red brick vs stone/plaster
  const terraMask = smoothstep(0.02, 0.12, vc.r.sub(vc.b)) as unknown as NF; // terracotta vs slate
  // setts only where the paint is BOTH low-warmth and bright: the damaged
  // approach shares the paved hue but is darker — it must stay broken dirt
  const cobbleMask = smoothstep(1.32, 1.58, vc.r.div(vc.b.max(0.05)))
    .oneMinus()
    .mul(smoothstep(0.44, 0.52, vc.r)) as unknown as NF;
  const soilMask = smoothstep(0.01, 0.06, vc.r.sub(vc.g)) as unknown as NF; // worn/crop ground vs meadow

  const detail = Fn(() => {
    const wp = isLocalKind ? attrPos() : (positionWorld as unknown as N3);
    const ground = vec2(wp.x, wp.z);
    // wall-friendly plane: horizontal position folded with height so vertical
    // surfaces vary along BOTH axes regardless of orientation
    const wall = vec2(wp.x.add(wp.z), wp.y.mul(1.25));

    const macro = vnoise(ground.div(9.3) as unknown as N2).sub(0.5).mul(0.16).add(1);
    const meso = vnoise((isGroundKind ? ground : wall).div(1.42) as unknown as N2).sub(0.5).mul(0.13).add(1);
    // photo micro detail supersedes half of the procedural micro band
    const microAmp = hasPhoto ? 0.05 : 0.1;
    const micro = vnoise((isGroundKind ? ground : wall).div(0.21) as unknown as N2).sub(0.5).mul(microAmp).add(1);

    let k: NF = macro.mul(meso).mul(micro) as unknown as NF;

    if (kind === 'masonry' || kind === 'stone') {
      const course = wp.y.div(0.4);
      const row = floor(course);
      const hEdge = abs(fract(course).sub(0.5)).mul(2);
      const hMortar = smoothstep(0.8, 0.99, hEdge);
      const offset = row.mod(2).mul(0.5);
      const colU = wp.x.add(wp.z).div(0.62).add(offset);
      const vEdge = abs(fract(colU).sub(0.5)).mul(2);
      const vMortar = smoothstep(0.84, 0.99, vEdge);
      const mortar = hMortar.max(vMortar);
      const perStone = hash12(vec2(row, floor(colU)) as unknown as N2).mul(0.12).add(0.94);
      let coursing: NF = mix(float(1), float(0.72), mortar).mul(perStone) as unknown as NF;
      if (kind === 'masonry') {
        // Norman facades are lime render over rubble: the coursing shows only
        // in worn patches where the coat has flaked, never as a uniform grid
        const cover = smoothstep(0.3, 0.62, vnoise(wall.div(3.1) as unknown as N2));
        coursing = mix(coursing, float(1), cover) as unknown as NF;
        // the brick photo set brings its own bond pattern — fade the
        // procedural coursing out on brick-painted facades entirely
        coursing = mix(coursing, float(1), brickMask) as unknown as NF;
      }
      k = k.mul(coursing) as unknown as NF;
    } else if (kind === 'roof') {
      const tileCell = vec2(floor(wp.x.add(wp.z).div(0.44)), floor(wp.y.div(0.27)));
      k = k.mul(hash12(tileCell as unknown as N2).mul(0.17).add(0.915)) as unknown as NF;
    } else if (kind === 'wood' || kind === 'bark') {
      const grain = vnoise(vec2(wp.x.add(wp.z).div(0.07), wp.y.div(1.6)) as unknown as N2);
      k = k.mul(grain.sub(0.5).mul(0.14).add(1)) as unknown as NF;
    } else if (kind === 'road') {
      const speckle = hash12(vec2(floor(wp.x.mul(7.3)), floor(wp.z.mul(7.3))) as unknown as N2);
      const pebble = hash12(vec2(floor(wp.x.mul(23.0)), floor(wp.z.mul(23.0))) as unknown as N2);
      k = k.mul(speckle.mul(0.22).add(0.89)).mul(pebble.mul(0.14).add(0.93)) as unknown as NF;
    } else if (kind === 'soil') {
      const clod = vnoise(ground.div(0.45) as unknown as N2);
      k = k.mul(clod.sub(0.5).mul(0.16).add(1)) as unknown as NF;
    } else if (kind === 'foliage' || kind === 'grass') {
      const leaf = vnoise((kind === 'grass' ? ground : wall).div(0.5) as unknown as N2);
      k = k.mul(leaf.sub(0.5).mul(0.18).add(1)) as unknown as NF;
    } else if (kind === 'tracks') {
      // grouser bars across the track run (local X is the run direction)
      const t = fract(wp.x.div(0.145));
      const bar = smoothstep(0.1, 0.2, t).mul(smoothstep(0.6, 0.5, t));
      k = k.mul(bar.mul(0.16).add(0.92)) as unknown as NF;
    }

    // ---- photo albedo layer (normalized multiplier ~1.0 mean) -------------
    const wpv = wp.xyz as unknown as N3;
    let photo: N3 | null = null;
    if (kind === 'terrain') {
      const patch = smoothstep(0.35, 0.65, vnoise(ground.div(23) as unknown as N2)) as unknown as NF;
      const gA = albedoMul(SETS.grassA, texAt(mapTex(SETS.grassA, 'Color'), uvGround(wpv, SETS.grassA.tile)).rgb);
      const gB = albedoMul(SETS.grassB, texAt(mapTex(SETS.grassB, 'Color'), uvGround(wpv, SETS.grassB.tile)).rgb);
      const so = albedoMul(SETS.soil, texAt(mapTex(SETS.soil, 'Color'), uvGround(wpv, SETS.soil.tile)).rgb);
      photo = mix(mix(gA, gB, patch), so, soilMask) as unknown as N3;
    } else if (kind === 'grass') {
      photo = albedoMul(SETS.grassA, texAt(mapTex(SETS.grassA, 'Color'), uvGround(wpv, SETS.grassA.tile)).rgb);
    } else if (kind === 'soil') {
      photo = albedoMul(SETS.soil, texAt(mapTex(SETS.soil, 'Color'), uvGround(wpv, SETS.soil.tile)).rgb);
    } else if (kind === 'road') {
      const gravelMask = smoothstep(0.55, 0.8, vnoise(ground.div(1.7) as unknown as N2)) as unknown as NF;
      const dirt = albedoMul(SETS.soil, texAt(mapTex(SETS.soil, 'Color'), uvGround(wpv, 2.5)).rgb);
      const grav = albedoMul(SETS.gravel, texAt(mapTex(SETS.gravel, 'Color'), uvGround(wpv, SETS.gravel.tile)).rgb);
      const sett = albedoMul(SETS.setts, texAt(mapTex(SETS.setts, 'Color'), uvGround(wpv, SETS.setts.tile)).rgb);
      photo = mix(mix(dirt, grav, gravelMask), sett, cobbleMask) as unknown as N3;
    } else if (kind === 'masonry') {
      const w = triWeights(false);
      const pl = albedoMul(SETS.plaster, triRgb(mapTex(SETS.plaster, 'Color'), wpv, SETS.plaster.tile, w));
      const br = albedoMul(SETS.brick, triRgb(mapTex(SETS.brick, 'Color'), wpv, SETS.brick.tile, w));
      photo = mix(pl, br, brickMask) as unknown as N3;
    } else if (kind === 'roof') {
      const w = triWeights(false);
      const sl = albedoMul(SETS.slate, triRgb(mapTex(SETS.slate, 'Color'), wpv, SETS.slate.tile, w));
      const te = albedoMul(SETS.terra, triRgb(mapTex(SETS.terra, 'Color'), wpv, SETS.terra.tile, w));
      photo = mix(sl, te, terraMask) as unknown as N3;
    } else if (kind === 'stone') {
      const w = triWeights(false);
      photo = albedoMul(SETS.rock, triRgb(mapTex(SETS.rock, 'Color'), wpv, SETS.rock.tile, w));
    } else if (kind === 'bark') {
      const w = triWeights(false);
      photo = albedoMul(SETS.bark, triRgb(mapTex(SETS.bark, 'Color'), wpv, SETS.bark.tile, w));
    } else if (isLocalKind) {
      const w = triWeights(true);
      const set = SETS[kind as 'armor' | 'tracks' | 'cloth'];
      photo = albedoMul(set, triRgb(mapTex(set, 'Color'), wpv, set.tile, w));
    }

    let base = (photo ? photo.mul(k) : vec3(k, k, k)) as unknown as N3;
    // vehicle dust/mud: builds up from the local ground plane, patchy
    if (dustAmt > 0 && (kind === 'armor' || kind === 'tracks')) {
      const patch = vnoise(vec2(wp.x, wp.z).div(0.62) as unknown as N2).mul(0.55).add(0.55);
      const dust = smoothstep(dustH, dustH * 0.18, wp.y).mul(patch).mul(dustAmt);
      base = mix(base, base.mul(vec3(1.55, 1.42, 1.02)), dust) as unknown as N3;
    }
    return base;
  })();

  mat.colorNode = detail;

  // ---- REAL relief: finite differences of the height field (world space,
  // or local space for vehicle kinds) — procedural + photo disp, in meters
  const procAmp = PROC_AMP[kind];
  if (procAmp > 0 || HAS_DISP.has(kind)) {
    const w = isGroundKind ? null : triWeights(isLocalKind);

    /** Total height (meters) at an arbitrary world position. */
    const hTotal = (wp: N3): NF => {
      const ground = vec2(wp.x, wp.z);
      const wall = vec2(wp.x.add(wp.z), wp.y.mul(1.25));
      let h: NF = float(0) as unknown as NF;

      // procedural class structure
      if (kind === 'masonry') {
        const course = wp.y.div(0.4);
        const row = floor(course);
        const hEdge = abs(fract(course).sub(0.5)).mul(2);
        const hMortar = smoothstep(0.78, 1.0, hEdge);
        const offset = row.mod(2).mul(0.5);
        const colU = wp.x.add(wp.z).div(0.62).add(offset);
        const vEdge = abs(fract(colU).sub(0.5)).mul(2);
        const vMortar = smoothstep(0.82, 1.0, vEdge);
        const mortar = max(hMortar, vMortar);
        const domeU = abs(fract(colU).sub(0.5)).oneMinus();
        const domeV = abs(fract(course).sub(0.5)).oneMinus();
        const perStone = hash12(vec2(row, floor(colU)) as unknown as N2).mul(0.22);
        const coursing = float(0.72)
          .sub(mortar.mul(0.7))
          .add(domeU.mul(domeV).mul(0.14))
          .add(perStone)
          .add(fbm(wall.div(0.09) as unknown as N2).mul(0.12));
        // render-coat patches sit proud OVER the rubble; exposed stone shows
        // the coursing relief in the flaked hollows (edge lips read at low sun)
        const cover = smoothstep(0.3, 0.62, vnoise(wall.div(3.1) as unknown as N2));
        const rendered = mix(coursing.mul(0.9), float(1.0), cover);
        // brick facades get their bond from the photo displacement instead
        h = h.add(rendered.mul(procAmp).mul(brickMask.oneMinus())) as unknown as NF;
      } else if (kind === 'stone') {
        h = h.add(fbm(wall.div(0.09) as unknown as N2).mul(procAmp)) as unknown as NF;
      } else if (kind === 'wood') {
        const plank = fract(wp.x.add(wp.z).div(0.28));
        const groove = smoothstep(0.0, 0.09, plank).mul(smoothstep(1.0, 0.91, plank));
        h = h.add(
          groove.mul(0.55).add(vnoise(vec2(wp.x.add(wp.z).div(0.05), wp.y.div(1.4)) as unknown as N2).mul(0.35)).mul(procAmp),
        ) as unknown as NF;
      } else if (kind === 'road') {
        h = h.add(fbm(ground.div(0.22) as unknown as N2).mul(procAmp)) as unknown as NF;
      } else if (kind === 'soil') {
        h = h.add(fbm(ground.div(0.4) as unknown as N2).mul(procAmp)) as unknown as NF;
      } else if (kind === 'terrain') {
        h = h.add(fbm(ground.div(0.6) as unknown as N2).mul(procAmp)) as unknown as NF;
      } else if (kind === 'metal' || kind === 'armor') {
        h = h.add(vnoise(wall.div(0.9) as unknown as N2).mul(procAmp)) as unknown as NF;
      } else if (kind === 'tracks') {
        const t = fract(wp.x.div(0.145));
        const bar = smoothstep(0.1, 0.2, t).mul(smoothstep(0.6, 0.5, t));
        h = h.add(bar.mul(procAmp)) as unknown as NF;
      } else if (kind === 'roof' || kind === 'bark') {
        h = h.add(fbm(wall.div(0.3) as unknown as N2).mul(procAmp)) as unknown as NF;
      }

      // photo displacement (already mask-blended per surface class)
      const dispOf = (set: PbrSet, tile?: number): NF => {
        const t = mapTex(set, 'Displacement');
        const s = w ? triScalar(t, wp, tile ?? set.tile, w) : texAt(t, uvGround(wp, tile ?? set.tile)).r;
        return s.sub(0.5).mul(set.dispAmp) as unknown as NF;
      };
      if (kind === 'terrain') {
        h = h.add(mix(dispOf(SETS.grassA), dispOf(SETS.soil), soilMask)) as unknown as NF;
      } else if (kind === 'soil') {
        h = h.add(dispOf(SETS.soil)) as unknown as NF;
      } else if (kind === 'road') {
        h = h.add(mix(dispOf(SETS.soil, 2.5), dispOf(SETS.setts), cobbleMask)) as unknown as NF;
      } else if (kind === 'masonry') {
        h = h.add(mix(dispOf(SETS.plaster), dispOf(SETS.brick), brickMask)) as unknown as NF;
      } else if (kind === 'roof') {
        h = h.add(mix(dispOf(SETS.slate), dispOf(SETS.terra), terraMask)) as unknown as NF;
      } else if (kind === 'stone') {
        h = h.add(dispOf(SETS.rock)) as unknown as NF;
      } else if (kind === 'bark') {
        h = h.add(dispOf(SETS.bark)) as unknown as NF;
      } else if (kind === 'armor') {
        h = h.add(dispOf(SETS.armor)) as unknown as NF;
      }
      return h;
    };

    mat.normalNode = Fn(() => {
      const wp = isLocalKind ? attrPos() : (positionWorld.xyz as unknown as N3);
      const h0 = hTotal(wp);
      const gx = hTotal(wp.add(vec3(EPS, 0, 0)) as unknown as N3).sub(h0);
      const gy = hTotal(wp.add(vec3(0, EPS, 0)) as unknown as N3).sub(h0);
      const gz = hTotal(wp.add(vec3(0, 0, EPS)) as unknown as N3).sub(h0);
      const grad = vec3(gx, gy, gz).div(EPS);
      const nG = (isLocalKind ? attrNrm() : (normalWorld.xyz as unknown as N3)).normalize();
      const gTan = grad.sub(nG.mul(dot(grad, nG)));
      const nP = nG.sub(gTan).normalize();
      if (isLocalKind) {
        // perturbed in object space → let the node system apply the full
        // model chain (vehicle group/turret/gun rotations included)
        return (transformNormalToView as unknown as (n: unknown) => N3)(nP);
      }
      return mat4mulV4(cameraViewMatrix, vec4(nP, 0.0)).xyz.normalize();
    })();
  }

  // ---- roughness: photo structure around the tuned base + micro variance --
  const rBase = opts.roughness;
  const wpr = isLocalKind ? attrPos() : (positionWorld.xyz as unknown as N3);
  const varN = vnoise(vec2(wpr.x.add(wpr.z), wpr.y.add(wpr.z)).div(0.33) as unknown as N2)
    .sub(0.5)
    .mul(hasPhoto ? 0.08 : 0.16);
  let rough = float(rBase).add(varN) as unknown as NF;
  if (hasPhoto && kind !== 'grass') {
    const w = isGroundKind ? null : triWeights(isLocalKind);
    const roughOf = (set: PbrSet, tile?: number): NF => {
      const t = mapTex(set, 'Roughness');
      const s = w ? triScalar(t, wpr, tile ?? set.tile, w) : texAt(t, uvGround(wpr, tile ?? set.tile)).r;
      return roughDelta(set, s);
    };
    if (kind === 'terrain') rough = rough.add(mix(roughOf(SETS.grassA), roughOf(SETS.soil), soilMask)) as unknown as NF;
    else if (kind === 'soil') rough = rough.add(roughOf(SETS.soil)) as unknown as NF;
    else if (kind === 'road') rough = rough.add(mix(roughOf(SETS.soil, 2.5), roughOf(SETS.setts), cobbleMask)) as unknown as NF;
    else if (kind === 'masonry') rough = rough.add(mix(roughOf(SETS.plaster), roughOf(SETS.brick), brickMask)) as unknown as NF;
    else if (kind === 'roof') rough = rough.add(mix(roughOf(SETS.slate), roughOf(SETS.terra), terraMask)) as unknown as NF;
    else if (kind === 'stone') rough = rough.add(roughOf(SETS.rock)) as unknown as NF;
    else if (kind === 'bark') rough = rough.add(roughOf(SETS.bark)) as unknown as NF;
    else if (isLocalKind) {
      const set = SETS[kind as 'armor' | 'tracks' | 'cloth'];
      rough = rough.add(roughOf(set)) as unknown as NF;
      // dust films are matte — push roughness up where the hull is dusted
      if (dustAmt > 0) {
        const dust = smoothstep(dustH, dustH * 0.18, wpr.y).mul(dustAmt);
        rough = rough.add(dust.mul(0.12)) as unknown as NF;
      }
    }
  }
  mat.roughnessNode = clamp(rough, 0.3, 1.0);

  return mat;
}

// ---------------------------------------------------------------------------
// Photo leaf-card material: alpha-tested canopy cards (FoliageGenerator).
// The card geometry carries real UVs into a scanned CC0 leaf atlas whose
// background is pre-filled with the mean leaf colour, so alpha-test edges
// never fringe and distant mips blend toward foliage green instead of
// thinning out. Species tint stays in vertex colors × instance colors; the
// atlas is normalized to a mean-1.0 multiplier like every other photo set.
// ---------------------------------------------------------------------------

export type LeafSpecies = 'oak' | 'poplar' | 'apple' | 'bush';

const LEAF_SETS: Record<LeafSpecies, { asset: string; norm: readonly [number, number, number] }> = {
  oak: { asset: 'LeafSet016', norm: [8.68, 5.77, 30.53] },
  poplar: { asset: 'LeafSet004', norm: [22.88, 15.15, 41.04] },
  apple: { asset: 'LeafSet023', norm: [2.79, 1.88, 5.02] },
  bush: { asset: 'LeafSet014', norm: [3.82, 2.47, 13.13] },
};

const texAtUv = (t: Texture): TexSample =>
  (tslTexture as unknown as (tx: Texture) => TexSample)(t);

export function leafCardMaterial(species: LeafSpecies): MeshStandardNodeMaterial {
  const spec = LEAF_SETS[species];
  const mat = new MeshStandardNodeMaterial({ roughness: 0.62, metalness: 0 });
  mat.vertexColors = true;
  mat.side = DoubleSide;
  mat.shadowSide = DoubleSide;

  const colUrl = `/textures/${spec.asset}/${spec.asset}_1K-JPG_Color.jpg`;
  let colTex = texCache.get(colUrl);
  if (!colTex) {
    colTex = loader.load(colUrl);
    colTex.wrapS = RepeatWrapping;
    colTex.wrapT = RepeatWrapping;
    colTex.anisotropy = 8;
    colTex.colorSpace = SRGBColorSpace;
    texCache.set(colUrl, colTex);
  }
  const opUrl = `/textures/${spec.asset}/${spec.asset}_1K-JPG_Opacity.jpg`;
  let opTex = texCache.get(opUrl);
  if (!opTex) {
    opTex = loader.load(opUrl);
    opTex.wrapS = RepeatWrapping;
    opTex.wrapT = RepeatWrapping;
    texCache.set(opUrl, opTex);
  }

  let c = texAtUv(colTex).rgb.mul(vec3(spec.norm[0], spec.norm[1], spec.norm[2])) as unknown as N3;
  c = clamp(c, vec3(0.3, 0.3, 0.3), vec3(2.2, 2.2, 2.2)) as unknown as N3;
  const l = luminance(c as unknown as Parameters<typeof luminance>[0]) as unknown as NF;
  const mixN3 = mix as unknown as (a: N3, b: N3, t: number) => N3;
  const rgb = mixN3(vec3(l, l, l) as unknown as N3, c, 0.65);
  // boost so mip-averaged alpha keeps distant canopies solid, not skeletal
  const alpha = clamp(texAtUv(opTex).r.mul(1.5), 0.0, 1.0);
  // the cutout must ride in colorNode.a (NOT opacityNode): the WebGPU
  // shadow pass derives its alpha-test alpha from colorNode.a / map only,
  // so an opacityNode cutout would cast solid full-quad card shadows
  mat.colorNode = (vec4 as unknown as (c: N3, a: NF) => typeof mat.colorNode)(rgb, alpha as unknown as NF);
  mat.alphaTest = 0.4;
  return mat;
}
