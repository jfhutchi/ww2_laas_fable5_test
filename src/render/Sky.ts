/**
 * Procedural late-afternoon Normandy sky. No texture files: a vertex-colored
 * gradient dome warmed toward the sun (with an HDR near-white disc that ACES
 * tone mapping blooms to white), an additive sun-glow billboard, and a band
 * of cumulus billboards whose alpha maps are fBm painted into offscreen
 * canvases at build time. Fully deterministic from the seed.
 */

import {
  AdditiveBlending,
  BackSide,
  BufferAttribute,
  CanvasTexture,
  Color,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Scene,
  SphereGeometry,
  SRGBColorSpace,
} from 'three';
import { Rng, hash2D } from '../core/Random.ts';
import { fbm2D } from '../core/Noise.ts';
import { clamp01, lerp, smoothstep } from '../core/MathUtil.ts';
import { SUN_AZIMUTH, SUN_ELEVATION } from '../world/WorldConst.ts';

const DOME_RADIUS = 4800;

/** Unit direction pointing FROM the scene TOWARD the sun. */
const SUN_X = Math.sin(SUN_AZIMUTH) * Math.cos(SUN_ELEVATION);
const SUN_Y = Math.sin(SUN_ELEVATION);
const SUN_Z = Math.cos(SUN_AZIMUTH) * Math.cos(SUN_ELEVATION);

// Palette (linear-ish working values; tone mapping handles the rest).
const ZENITH_R = 0.15;
const ZENITH_G = 0.32;
const ZENITH_B = 0.74;
const HORIZON_R = 0.92;
const HORIZON_G = 0.78;
const HORIZON_B = 0.56;
const PEACH_R = 1.0;
const PEACH_G = 0.84;
const PEACH_B = 0.62;

// ------------------------------------------------------------------- dome

function buildDome(seed: number): Mesh {
  const geo = new SphereGeometry(DOME_RADIUS, 128, 96);
  const pos = geo.getAttribute('position');
  const colors = new Float32Array(pos.count * 3);

  for (let i = 0; i < pos.count; i++) {
    const px = pos.getX(i);
    const py = pos.getY(i);
    const pz = pos.getZ(i);
    const inv = 1 / (Math.hypot(px, py, pz) || 1);
    const dx = px * inv;
    const dy = py * inv;
    const dz = pz * inv;

    // zenith -> horizon gradient (horizon band kept wide via the pow curve)
    const up = clamp01(dy);
    const gradT = Math.pow(1 - up, 2.0);
    let r = lerp(ZENITH_R, HORIZON_R, gradT);
    let g = lerp(ZENITH_G, HORIZON_G, gradT);
    let b = lerp(ZENITH_B, HORIZON_B, gradT);

    // below the horizon: continue the horizon tone, gently dimmed haze
    const below = clamp01(-dy * 2.6);
    const dim = 1 - below * 0.17;
    r *= dim;
    g *= dim;
    b *= dim * 0.98;

    // warm the whole sun side of the sky, strongest near the horizon
    const d = dx * SUN_X + dy * SUN_Y + dz * SUN_Z;
    const broad = Math.pow(clamp01(d * 0.5 + 0.5), 4) * (1 - up * 0.72) * 0.26;
    r = lerp(r, 0.95, broad);
    g = lerp(g, 0.79, broad);
    b = lerp(b, 0.58, broad);

    // bright warm glow lobe around the sun
    const glow = Math.pow(clamp01(d), 8);
    r = lerp(r, PEACH_R, glow * 0.92);
    g = lerp(g, PEACH_G, glow * 0.92);
    b = lerp(b, PEACH_B, glow * 0.92);

    // small intense sun disc: HDR near-white, ACES pulls it to hot white
    if (d > 0.9994) {
      r = 1.0 * 3;
      g = 0.95 * 3;
      b = 0.85 * 3;
    }

    // tiny deterministic dither to break gradient banding
    const dith = (hash2D(i, 733, seed) - 0.5) * 0.014;
    colors[i * 3] = r + dith;
    colors[i * 3 + 1] = g + dith;
    colors[i * 3 + 2] = b + dith;
  }
  geo.setAttribute('color', new BufferAttribute(colors, 3));

  const mat = new MeshBasicMaterial({
    vertexColors: true,
    side: BackSide,
    depthWrite: false,
    fog: false,
  });
  const mesh = new Mesh(geo, mat);
  mesh.renderOrder = -100;
  mesh.frustumCulled = false; // camera is always inside the dome
  mesh.name = 'sky-dome';
  return mesh;
}

// -------------------------------------------------------------- sun sprite

/**
 * Soft additive halo + crisp core. The dome tessellation is too coarse to
 * carve a clean 2-degree disc from vertices alone, so this billboard
 * guarantees the disc silhouette; the vertex-color disc above feeds the glow.
 */
function buildSunSprite(): Mesh {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Sky: 2D canvas context unavailable');

  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0.0, 'rgba(255, 250, 236, 1.0)');
  grad.addColorStop(0.26, 'rgba(255, 246, 224, 1.0)');
  grad.addColorStop(0.34, 'rgba(255, 226, 176, 0.42)');
  grad.addColorStop(0.56, 'rgba(255, 202, 138, 0.15)');
  grad.addColorStop(1.0, 'rgba(255, 188, 122, 0.0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;

  const mat = new MeshBasicMaterial({
    map: tex,
    transparent: true,
    depthWrite: false,
    fog: false,
    blending: AdditiveBlending,
  });
  const mesh = new Mesh(new PlaneGeometry(1, 1), mat);
  const dist = DOME_RADIUS * 0.96;
  mesh.position.set(SUN_X * dist, SUN_Y * dist, SUN_Z * dist);
  mesh.scale.set(1050, 1050, 1);
  mesh.lookAt(0, 0, 0);
  mesh.renderOrder = -99;
  mesh.name = 'sky-sun';
  return mesh;
}

// ------------------------------------------------------------------ clouds

/** Paint a cumulus alpha sprite: elliptical radial falloff gating fBm. */
function makeCloudTexture(seed: number, variant: number): CanvasTexture {
  const S = 256;
  const canvas = document.createElement('canvas');
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Sky: 2D canvas context unavailable');

  const img = ctx.createImageData(S, S);
  const data = img.data;
  const nSeed = (seed + variant * 0x1f123) >>> 0;
  const ox = variant * 3.71 + 1.3;

  for (let py = 0; py < S; py++) {
    const ny = (py / (S - 1)) * 2 - 1; // -1 top .. +1 bottom
    for (let px = 0; px < S; px++) {
      const nx = (px / (S - 1)) * 2 - 1;

      const rr = Math.hypot(nx / 0.86, ny / 0.58);
      const shape = 1 - smoothstep(0.38, 1.0, rr);
      let dens = fbm2D(nx * 2.4 + ox, ny * 3.4 - ox * 0.7, nSeed, 4);
      dens = clamp01((dens * 1.6 - 0.55) * 2.3) * shape;
      // flatten and thin the base — cumulus sit on flat-ish bottoms
      dens *= 1 - smoothstep(0.4, 0.85, ny);
      const alpha = Math.pow(clamp01(dens), 0.9);

      // warm-lit bottoms (low sun), near-white tops
      const litT = clamp01(ny * 0.6 + 0.5);
      const idx = (py * S + px) * 4;
      data[idx] = Math.round(255 * lerp(0.985, 1.0, litT));
      data[idx + 1] = Math.round(255 * lerp(0.975, 0.9, litT));
      data[idx + 2] = Math.round(255 * lerp(0.97, 0.78, litT));
      data[idx + 3] = Math.round(alpha * 255);
    }
  }
  ctx.putImageData(img, 0, 0);

  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  return tex;
}

// ------------------------------------------------------------------- entry

/**
 * Billboard cumulus band (near-horizon) layered together with the raymarched
 * VolumetricClouds deck (render/VolumetricClouds.ts) overhead — this combined
 * cloudscape is the look validated in trees-check.png (user-preferred).
 */
const ENABLE_BILLBOARD_CLOUDS = true;

export function buildSky(scene: Scene, seed: number): Group {
  const group = new Group();
  group.name = 'sky';
  group.add(buildDome(seed));
  group.add(buildSunSprite());

  if (ENABLE_BILLBOARD_CLOUDS) {
    const rng = new Rng((seed ^ 0x51c7a3) >>> 0);
    const textures = [0, 1, 2].map((v) => makeCloudTexture((seed ^ 0x9e3779) >>> 0, v));
    const cloudGeo = new PlaneGeometry(1, 1);
    const count = rng.int(10, 16);
    for (let i = 0; i < count; i++) {
      const az = rng.range(0, Math.PI * 2);
      const el = (3 + 11 * Math.pow(rng.float(), 1.7)) * (Math.PI / 180);
      const dist = rng.range(1500, 3500);
      const width = rng.range(300, 900);
      const height = width * rng.range(0.3, 0.52);
      const mat = new MeshBasicMaterial({
        map: rng.pick(textures),
        transparent: true,
        depthWrite: false,
        fog: false,
        side: DoubleSide,
        opacity: rng.range(0.5, 0.85),
        color: new Color(1.0, rng.range(0.93, 0.99), rng.range(0.86, 0.96)),
      });
      const mesh = new Mesh(cloudGeo, mat);
      mesh.position.set(
        Math.sin(az) * Math.cos(el) * dist,
        Math.sin(el) * dist,
        Math.cos(az) * Math.cos(el) * dist,
      );
      mesh.scale.set(rng.chance(0.5) ? -width : width, height, 1);
      mesh.lookAt(0, 0, 0);
      mesh.renderOrder = -98;
      mesh.name = `sky-cloud-${i}`;
      group.add(mesh);
    }
  }

  scene.add(group);
  return group;
}
