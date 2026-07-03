/**
 * MinimapData — paints a top-down tactical map of the WorldModel onto an
 * offscreen canvas, in the style of an aged WWII field map crossed with an
 * aerial reconnaissance photo: muted olive terrain with crop tinting and
 * hill shading, inked roads and bocage lines, building footprints, crater
 * rings, the capture-zone circle, a light 8x8 grid, north arrow and a
 * darkened sheet edge.
 *
 * Rendering is pure 2D canvas and fully deterministic: every jittered value
 * derives from hash2D/fbm2D keyed by model.seed or per-spec seeds. The base
 * terrain pass runs on a coarse cell grid written into an ImageData and is
 * then upscaled with smoothing, which keeps the whole paint comfortably
 * under the 250 ms budget at 1024 px.
 */

import { fbm2D } from '../core/Noise.ts';
import { hash2D } from '../core/Random.ts';
import { clamp, clamp01, lerp, smoothstep } from '../core/MathUtil.ts';
import { PLAY_HALF, SUN_AZIMUTH, VILLAGE_RADIUS } from './WorldConst.ts';
import type { Ground } from './Ground.ts';
import type { BarrierSegment, CropKind, Road, RoadKind, WorldModel } from './WorldTypes.ts';
import { pointInPolygon } from './WorldTypes.ts';

export interface MinimapMaps {
  canvas: HTMLCanvasElement;
  sizePx: number;
  worldHalf: number;
}

/** World → map UV. u right (+x), v DOWN (+z), both clamped to 0..1. */
export function worldToMap(m: MinimapMaps, x: number, z: number): { u: number; v: number } {
  const inv = 1 / (2 * m.worldHalf);
  return {
    u: clamp01((x + m.worldHalf) * inv),
    v: clamp01((z + m.worldHalf) * inv),
  };
}

// -------------------------------------------------------------- palette

type Rgb = readonly [number, number, number];

const GROUND_RGB: Rgb = [107, 111, 78]; // #6b6f4e muted field-grey/olive
const VILLAGE_RGB: Rgb = [110, 107, 97]; // grey cast over the built-up area
const ROAD_TINT_RGB: Rgb = [166, 152, 126]; // dusty verge under-tint
const CRATER_RGB: Rgb = [72, 66, 54]; // churned earth
const STAIN_RGB: Rgb = [124, 113, 86]; // aged-paper staining

const CROP_RGB: Record<CropKind, Rgb> = {
  wheat: [138, 124, 70], // #8a7c46
  pasture: [95, 112, 64], // #5f7040
  plow: [109, 88, 68], // #6d5844
  hay: [131, 122, 78], // #837a4e
  orchard: [92, 110, 61], // #5c6e3d
};

const COL_PAVED = '#b8b2a4';
const COL_PAVED_CASING = 'rgba(88,82,68,0.5)';
const COL_DIRT = '#a08a66';
const COL_DAMAGED = '#9a948a';
const COL_POTHOLE = 'rgba(58,53,42,0.65)';
const COL_HEDGE = '#3a4a26';
const COL_WALL = '#8d8a80';
const COL_FENCE = '#7a6f5c';
const COL_BUILDING = '#3d3a34';
const COL_CHURCH = '#2f2c28';
const COL_CROSS = '#d8d4c4';
const COL_CRATER_RING = 'rgba(40,35,27,0.55)';
const COL_CRATER_CORE = 'rgba(35,30,23,0.5)';
const COL_CAPTURE = '#d8d4c4';
const COL_GRID = '#00000018';
const COL_ORCHARD_DOT = '#46572f';
const COL_INK = '#2f2c28';

// ---------------------------------------------------------------- painter

/** Shared per-paint context: canvas, scales and world→pixel mapping. */
interface Painter {
  readonly ctx: CanvasRenderingContext2D;
  readonly sizePx: number;
  readonly worldHalf: number;
  /** Stroke/symbol scale — 1 at a 1024 px sheet. */
  readonly k: number;
  /** Pixels per world meter. */
  readonly s: number;
  readonly seed: number;
  px(x: number): number;
  py(z: number): number;
}

export function paintMinimap(model: WorldModel, ground: Ground, sizePx: number): MinimapMaps {
  const worldHalf = PLAY_HALF;
  const canvas = document.createElement('canvas');
  canvas.width = sizePx;
  canvas.height = sizePx;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('MinimapData: 2D canvas context unavailable');

  const s = sizePx / (worldHalf * 2);
  const p: Painter = {
    ctx,
    sizePx,
    worldHalf,
    k: sizePx / 1024,
    s,
    seed: model.seed | 0,
    px: (x: number) => (x + worldHalf) * s,
    py: (z: number) => (z + worldHalf) * s,
  };

  paintBase(p, model, ground);
  paintOrchardDots(p, model);
  paintRoads(p, model);
  paintBarriers(p, model);
  paintBuildings(p, model);
  paintCraters(p, model);
  paintGrid(p);
  paintCaptureZone(p, model);
  paintVignette(p);
  paintNorthArrow(p);

  return { canvas, sizePx, worldHalf };
}

// ------------------------------------------------------------- base layer

/**
 * Coarse terrain pass: one sample per ~3 screen px written straight into an
 * ImageData, then upscaled with bilinear smoothing. Tints combine crop type,
 * elevation value shift (±8%), a soft NW/SE hill shade tied to SUN_AZIMUTH,
 * village greying, road/crater under-tints, paper staining and grain.
 */
function paintBase(p: Painter, model: WorldModel, ground: Ground): void {
  const cells = Math.max(96, Math.min(344, Math.round(p.sizePx / 3)));
  const tmp = document.createElement('canvas');
  tmp.width = cells;
  tmp.height = cells;
  const tctx = tmp.getContext('2d');
  if (!tctx) throw new Error('MinimapData: 2D canvas context unavailable');

  const img = tctx.createImageData(cells, cells);
  const data = img.data;
  const heights = new Float32Array(cells * cells);
  const cellM = (p.worldHalf * 2) / cells;
  const seed = p.seed;
  // horizontal sun direction for the hill shade (late-afternoon WSW light)
  const lx = Math.cos(SUN_AZIMUTH);
  const lz = Math.sin(SUN_AZIMUTH);
  const vcx = model.roads.center.x;
  const vcz = model.roads.center.z;

  for (let cz = 0; cz < cells; cz++) {
    const z = -p.worldHalf + (cz + 0.5) * cellM;
    for (let cx = 0; cx < cells; cx++) {
      const x = -p.worldHalf + (cx + 0.5) * cellM;
      const i = cz * cells + cx;
      const h = ground.baseHeight(x, z);
      heights[i] = h;

      let r: number = GROUND_RGB[0];
      let g: number = GROUND_RGB[1];
      let b: number = GROUND_RGB[2];

      // crop tint
      const field = ground.fieldAt(x, z);
      if (field) {
        const c = CROP_RGB[field.crop];
        r = lerp(r, c[0], 0.85);
        g = lerp(g, c[1], 0.85);
        b = lerp(b, c[2], 0.85);
        // furrow/crop-row striping (aerial-photo feel) on worked fields
        if (field.crop === 'plow' || field.crop === 'wheat') {
          const spacing = field.crop === 'plow' ? 7 : 5;
          const d = x * Math.cos(field.rowDir) + z * Math.sin(field.rowDir);
          const fr = d / spacing - Math.floor(d / spacing);
          const tri = Math.abs(fr - 0.5) * 2;
          const amp = field.crop === 'plow' ? 0.1 : 0.06;
          const m = 1 + (tri - 0.5) * amp;
          r *= m;
          g *= m;
          b *= m;
        }
        // per-field identity jitter so adjacent same-crop parcels separate
        const fj = 1 + (hash2D(field.id, 17, seed ^ 0x3f1) - 0.5) * 0.09;
        r *= fj;
        g *= fj;
        b *= fj;
      }

      // village grey cast
      const vr = Math.hypot(x - vcx, z - vcz);
      const vk = 1 - smoothstep(VILLAGE_RADIUS * 0.5, VILLAGE_RADIUS, vr);
      if (vk > 0) {
        r = lerp(r, VILLAGE_RGB[0], vk * 0.32);
        g = lerp(g, VILLAGE_RGB[1], vk * 0.32);
        b = lerp(b, VILLAGE_RGB[2], vk * 0.32);
      }

      // dusty under-tint where roads run (crisp strokes come later)
      const rm = ground.roadMask(x, z);
      if (rm > 0) {
        const t = rm * 0.45;
        r = lerp(r, ROAD_TINT_RGB[0], t);
        g = lerp(g, ROAD_TINT_RGB[1], t);
        b = lerp(b, ROAD_TINT_RGB[2], t);
      }

      // churned earth around craters
      const cm = ground.craterMask(x, z);
      if (cm > 0) {
        const t = cm * 0.45;
        r = lerp(r, CRATER_RGB[0], t);
        g = lerp(g, CRATER_RGB[1], t);
        b = lerp(b, CRATER_RGB[2], t);
      }

      // aged-paper staining in broad blotches
      const st = fbm2D(x * 0.0031 + 31.7, z * 0.0031 - 12.3, seed ^ 0xb22, 2);
      if (st > 0.55) {
        const t = Math.min(0.28, (st - 0.55) * 1.1);
        r = lerp(r, STAIN_RGB[0], t);
        g = lerp(g, STAIN_RGB[1], t);
        b = lerp(b, STAIN_RGB[2], t);
      }

      // value: mottle * elevation (±8%) * hill shade * grain
      const mottle = 1 + (fbm2D(x * 0.021, z * 0.021, seed ^ 0xa11, 3) - 0.5) * 0.14;
      const elev = 1 + clamp(h / 8, -1, 1) * 0.08;
      let shade = 0;
      if (cx > 0 && cz > 0) {
        const hl = heights[i - 1] ?? h;
        const hu = heights[i - cells] ?? h;
        const gx = (h - hl) / cellM;
        const gz = (h - hu) / cellM;
        // slopes falling toward the low sun catch the light
        shade = clamp(-(gx * lx + gz * lz) * 2.2, -0.06, 0.06);
      }
      const grain = 1 + (hash2D(cx, cz, seed ^ 0x771) - 0.5) * 0.05;
      const v = mottle * elev * (1 + shade) * grain;

      const o = i * 4;
      data[o] = r * v;
      data[o + 1] = g * v;
      data[o + 2] = b * v;
      data[o + 3] = 255;
    }
  }

  tctx.putImageData(img, 0, 0);
  p.ctx.imageSmoothingEnabled = true;
  p.ctx.imageSmoothingQuality = 'high';
  p.ctx.drawImage(tmp, 0, 0, p.sizePx, p.sizePx);
}

// ---------------------------------------------------------- orchard rows

/** Regular rows of tree dots across each orchard parcel, jittered per tree. */
function paintOrchardDots(p: Painter, model: WorldModel): void {
  const ctx = p.ctx;
  const dotR = Math.max(0.9, 1.3 * p.k);
  ctx.fillStyle = COL_ORCHARD_DOT;
  ctx.beginPath();
  for (const f of model.fields) {
    if (f.crop !== 'orchard') continue;
    const ux = Math.cos(f.rowDir);
    const uz = Math.sin(f.rowDir);
    const vx = -uz;
    const vz = ux;
    let minU = Infinity;
    let maxU = -Infinity;
    let minV = Infinity;
    let maxV = -Infinity;
    for (const q of f.polygon) {
      const U = q.x * ux + q.z * uz;
      const V = q.x * vx + q.z * vz;
      minU = Math.min(minU, U);
      maxU = Math.max(maxU, U);
      minV = Math.min(minV, V);
      maxV = Math.max(maxV, V);
    }
    const su = 9; // tree spacing along a row
    const sv = 12; // spacing between rows
    for (let iv = Math.ceil(minV / sv); iv * sv <= maxV; iv++) {
      for (let iu = Math.ceil(minU / su); iu * su <= maxU; iu++) {
        const jx = (hash2D(iu, iv, f.seed) - 0.5) * 2.4;
        const jz = (hash2D(iv, iu, f.seed ^ 0x9e37) - 0.5) * 2.4;
        const U = iu * su;
        const V = iv * sv;
        const wx = U * ux + V * vx + jx;
        const wz = U * uz + V * vz + jz;
        if (!pointInPolygon(wx, wz, f.polygon)) continue;
        const X = p.px(wx);
        const Y = p.py(wz);
        ctx.moveTo(X + dotR, Y);
        ctx.arc(X, Y, dotR, 0, Math.PI * 2);
      }
    }
  }
  ctx.fill();
}

// ----------------------------------------------------------------- roads

function strokeRoadPath(p: Painter, road: Road): void {
  const ctx = p.ctx;
  ctx.beginPath();
  let started = false;
  for (const pt of road.points) {
    const X = p.px(pt.x);
    const Y = p.py(pt.z);
    if (started) ctx.lineTo(X, Y);
    else {
      ctx.moveTo(X, Y);
      started = true;
    }
  }
  ctx.stroke();
}

function paintRoads(p: Painter, model: WorldModel): void {
  const ctx = p.ctx;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  const order: readonly RoadKind[] = ['dirt', 'damaged', 'paved'];
  for (const kind of order) {
    for (const road of model.roads.roads) {
      if (road.kind !== kind || road.points.length < 2) continue;
      if (kind === 'paved') {
        ctx.setLineDash([]);
        ctx.strokeStyle = COL_PAVED_CASING;
        ctx.lineWidth = Math.max(1.2, 4.6 * p.k);
        strokeRoadPath(p, road);
        ctx.strokeStyle = COL_PAVED;
        ctx.lineWidth = Math.max(0.9, 3 * p.k);
        strokeRoadPath(p, road);
      } else if (kind === 'dirt') {
        ctx.setLineDash([]);
        ctx.strokeStyle = COL_DIRT;
        ctx.lineWidth = Math.max(0.8, 2.5 * p.k);
        strokeRoadPath(p, road);
      } else {
        // shell-damaged surface: broken casing plus pothole spots
        ctx.strokeStyle = COL_DAMAGED;
        ctx.lineWidth = Math.max(0.9, 3 * p.k);
        ctx.setLineDash([9 * p.k, 3.2 * p.k]);
        ctx.lineDashOffset = hash2D(road.id, 3, p.seed) * 12 * p.k;
        strokeRoadPath(p, road);
        ctx.setLineDash([]);
        ctx.lineDashOffset = 0;
        paintPotholes(p, road);
      }
    }
  }
  ctx.setLineDash([]);
}

/** Dark pothole spots scattered deterministically along a damaged road. */
function paintPotholes(p: Painter, road: Road): void {
  const ctx = p.ctx;
  ctx.fillStyle = COL_POTHOLE;
  ctx.beginPath();
  let acc = 0;
  let next = 9 + hash2D(road.id, 11, p.seed ^ 0x123) * 8;
  for (let i = 0; i < road.points.length - 1; i++) {
    const a = road.points[i];
    const b = road.points[i + 1];
    if (!a || !b) continue;
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dz);
    if (len < 1e-6) continue;
    while (next <= acc + len) {
      const t = (next - acc) / len;
      const key = Math.round(next);
      if (hash2D(key, road.id, p.seed ^ 0x9a7) < 0.5) {
        const lat = (hash2D(key, road.id ^ 0x55, p.seed) - 0.5) * road.width * 0.55;
        const nx = -dz / len;
        const nz = dx / len;
        const wx = a.x + dx * t + nx * lat;
        const wz = a.z + dz * t + nz * lat;
        const X = p.px(wx);
        const Y = p.py(wz);
        const r = Math.max(0.7, (0.8 + hash2D(key, road.id ^ 0xaa, p.seed) * 0.9) * p.k);
        ctx.moveTo(X + r, Y);
        ctx.arc(X, Y, r, 0, Math.PI * 2);
      }
      next += 8 + hash2D(key, road.id ^ 0x33, p.seed) * 9;
    }
    acc += len;
  }
  ctx.fill();
}

// -------------------------------------------------------------- barriers

/** Adds a barrier to the current path, leaving a rubble gap when broken. */
function addBarrierPath(p: Painter, seg: BarrierSegment): void {
  const ctx = p.ctx;
  const gap = seg.broken > 0.3 ? Math.min(0.7, seg.broken * 0.6) : 0;
  if (gap === 0) {
    ctx.moveTo(p.px(seg.x0), p.py(seg.z0));
    ctx.lineTo(p.px(seg.x1), p.py(seg.z1));
    return;
  }
  const gc = 0.35 + hash2D(seg.id, 5, seg.seed) * 0.3;
  const t0 = Math.max(0, gc - gap / 2);
  const t1 = Math.min(1, gc + gap / 2);
  const dx = seg.x1 - seg.x0;
  const dz = seg.z1 - seg.z0;
  if (t0 > 0.02) {
    ctx.moveTo(p.px(seg.x0), p.py(seg.z0));
    ctx.lineTo(p.px(seg.x0 + dx * t0), p.py(seg.z0 + dz * t0));
  }
  if (t1 < 0.98) {
    ctx.moveTo(p.px(seg.x0 + dx * t1), p.py(seg.z0 + dz * t1));
    ctx.lineTo(p.px(seg.x1), p.py(seg.z1));
  }
}

function paintBarriers(p: Painter, model: WorldModel): void {
  const ctx = p.ctx;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  ctx.strokeStyle = COL_HEDGE;
  ctx.lineWidth = Math.max(0.9, 2 * p.k);
  ctx.setLineDash([]);
  ctx.beginPath();
  for (const seg of model.barriers) if (seg.kind === 'hedgerow') addBarrierPath(p, seg);
  ctx.stroke();

  ctx.strokeStyle = COL_WALL;
  ctx.lineWidth = Math.max(0.75, 1.5 * p.k);
  ctx.beginPath();
  for (const seg of model.barriers) if (seg.kind === 'stone-wall') addBarrierPath(p, seg);
  ctx.stroke();

  ctx.strokeStyle = COL_FENCE;
  ctx.lineWidth = Math.max(0.7, 1.4 * p.k);
  ctx.setLineDash([1.1 * p.k, 3.4 * p.k]);
  ctx.beginPath();
  for (const seg of model.barriers) if (seg.kind === 'fence') addBarrierPath(p, seg);
  ctx.stroke();
  ctx.setLineDash([]);
}

// ------------------------------------------------------------- buildings

function paintBuildings(p: Painter, model: WorldModel): void {
  const ctx = p.ctx;
  for (const b of model.buildings) {
    const X = p.px(b.x);
    const Y = p.py(b.z);
    const w = Math.max(2, 2.4 * p.k, b.halfW * 2 * p.s);
    const d = Math.max(2, 2.4 * p.k, b.halfD * 2 * p.s);
    ctx.save();
    ctx.translate(X, Y);
    // canvas x/y ≡ world x/z, so the layout rotation applies directly
    ctx.rotate(b.rotation);
    ctx.globalAlpha = b.damage === 'ruined' ? 0.45 : b.damage === 'damaged' ? 0.8 : 1;
    ctx.fillStyle = b.kind === 'church' ? COL_CHURCH : COL_BUILDING;
    ctx.fillRect(-w / 2, -d / 2, w, d);
    if (b.damage === 'ruined') {
      // half-tone footprint keeps its outline so the ruin still reads
      ctx.globalAlpha = 0.6;
      ctx.strokeStyle = COL_BUILDING;
      ctx.lineWidth = Math.max(0.7, 0.9 * p.k);
      ctx.strokeRect(-w / 2, -d / 2, w, d);
    }
    ctx.restore();
    if (b.kind === 'church') {
      // north-up cross symbol, map-marker style
      ctx.globalAlpha = b.damage === 'ruined' ? 0.55 : 0.9;
      ctx.strokeStyle = COL_CROSS;
      ctx.lineWidth = Math.max(0.9, 1.3 * p.k);
      ctx.lineCap = 'butt';
      const a = 4.6 * p.k;
      ctx.beginPath();
      ctx.moveTo(X, Y - a);
      ctx.lineTo(X, Y + a);
      ctx.moveTo(X - a * 0.62, Y - a * 0.28);
      ctx.lineTo(X + a * 0.62, Y - a * 0.28);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }
  ctx.globalAlpha = 1;
}

// --------------------------------------------------------------- craters

function paintCraters(p: Painter, model: WorldModel): void {
  const ctx = p.ctx;
  ctx.setLineDash([]);
  ctx.beginPath();
  for (const c of model.craters) {
    const X = p.px(c.x);
    const Y = p.py(c.z);
    const r = Math.max(1.4 * p.k, c.radius * p.s);
    ctx.moveTo(X + r, Y);
    ctx.arc(X, Y, r, 0, Math.PI * 2);
  }
  ctx.strokeStyle = COL_CRATER_RING;
  ctx.lineWidth = Math.max(0.7, 1 * p.k);
  ctx.stroke();

  // fresh hits get a scorched core
  ctx.beginPath();
  for (const c of model.craters) {
    if (c.age > 0.35) continue;
    const X = p.px(c.x);
    const Y = p.py(c.z);
    const r = Math.max(0.8, c.radius * p.s * 0.4);
    ctx.moveTo(X + r, Y);
    ctx.arc(X, Y, r, 0, Math.PI * 2);
  }
  ctx.fillStyle = COL_CRATER_CORE;
  ctx.fill();
}

// ---------------------------------------------------------- overlay layer

function paintGrid(p: Painter): void {
  const ctx = p.ctx;
  const n = 8;
  const step = p.sizePx / n;
  ctx.strokeStyle = COL_GRID;
  ctx.lineWidth = Math.max(0.75, p.k);
  ctx.setLineDash([]);
  ctx.beginPath();
  for (let i = 1; i < n; i++) {
    const q = i * step;
    ctx.moveTo(q, 0);
    ctx.lineTo(q, p.sizePx);
    ctx.moveTo(0, q);
    ctx.lineTo(p.sizePx, q);
  }
  ctx.stroke();
}

function paintCaptureZone(p: Painter, model: WorldModel): void {
  const ctx = p.ctx;
  const X = p.px(model.captureZone.x);
  const Y = p.py(model.captureZone.z);
  const r = model.captureZone.radius * p.s;
  ctx.strokeStyle = COL_CAPTURE;
  ctx.lineWidth = Math.max(1.2, 2 * p.k);
  ctx.setLineDash([6 * p.k, 4 * p.k]);
  ctx.beginPath();
  ctx.arc(X, Y, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);

  const dotR = Math.max(3.5, 6 * p.k);
  const grad = ctx.createRadialGradient(X, Y, 0, X, Y, dotR);
  grad.addColorStop(0, 'rgba(216,212,196,0.85)');
  grad.addColorStop(1, 'rgba(216,212,196,0)');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(X, Y, dotR, 0, Math.PI * 2);
  ctx.fill();
}

function paintVignette(p: Painter): void {
  const ctx = p.ctx;
  const S = p.sizePx;
  const grad = ctx.createRadialGradient(S / 2, S / 2, S * 0.4, S / 2, S / 2, S * 0.72);
  grad.addColorStop(0, 'rgba(43,36,22,0)');
  grad.addColorStop(1, 'rgba(43,36,22,0.3)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, S, S);

  // sheet border: heavy outer ink line + faint light inner frame
  const outer = Math.max(1.5, 2 * p.k);
  ctx.strokeStyle = 'rgba(32,27,18,0.55)';
  ctx.lineWidth = outer;
  ctx.strokeRect(outer / 2, outer / 2, S - outer, S - outer);
  ctx.strokeStyle = 'rgba(216,212,196,0.16)';
  ctx.lineWidth = Math.max(0.7, p.k);
  const inset = 5 * p.k;
  ctx.strokeRect(inset, inset, S - inset * 2, S - inset * 2);
}

function paintNorthArrow(p: Painter): void {
  const ctx = p.ctx;
  const k = p.k;
  const X = p.sizePx - 36 * k;
  const Y = 38 * k;

  ctx.fillStyle = 'rgba(214,208,190,0.5)';
  ctx.beginPath();
  ctx.arc(X, Y, 19 * k, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = COL_INK;
  ctx.font = `bold ${Math.max(8, Math.round(12 * k))}px Georgia, "Times New Roman", serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('N', X, Y - 9 * k);

  // barbed arrow pointing up (north = -z = map up)
  ctx.beginPath();
  ctx.moveTo(X, Y - 2 * k);
  ctx.lineTo(X + 4.6 * k, Y + 13 * k);
  ctx.lineTo(X, Y + 9 * k);
  ctx.lineTo(X - 4.6 * k, Y + 13 * k);
  ctx.closePath();
  ctx.fill();
}
