/**
 * Volumetric cumulus layer, ported from the LAAS benchmark (src/sky/Clouds.ts)
 * and scaled for this game:
 *
 *  - single altitude band 900–1500 m (below LAAS's alpine 1250–1900 band)
 *  - base perlin–worley density in a 64³ field and a 32³ worley erosion
 *    field, baked ONCE on the CPU (period-wrapped fbm3D/worley3D,
 *    Schneider-style remap) and packed into 2D SLICE ATLASES sampled with
 *    manual trilinear interpolation. The original compute bake into r16float
 *    STORAGE 3D textures was broken off desktop-Dawn twice over: r16float is
 *    not a legal WebGPU storage format, and this Dawn/SwiftShader stack
 *    builds invalid 2D views for EVERY 3D-texture operation (lazy clear,
 *    writeTexture), dropping each command buffer that touches one → black
 *    frame. 2D atlases are spec-clean on every stack, fully initialized at
 *    upload, and deterministic.
 *  - a 256² weather/coverage field over 16 km (3-octave fbm with the LAAS
 *    contrast stretch smoothstep(0.3,0.78) baked in, seeded domain offset)
 *  - march(): 24 fixed front-to-back steps with a per-pixel STATIC spatial
 *    dither (hash12(screenUV·k) — no per-frame advance, we do not lean on
 *    TAA), 2 sun taps at 180 m spacing (exp(-0.04·τ)), dual-lobe HG phase
 *    (g = 0.62 / −0.18) + 0.14 isotropic floor, powder 1−exp(−22ρ), Beer
 *    step exp(−0.052·ρ·seg), early Break at transmittance < 0.02
 *  - every lookup wraps its domain with a manual .fract(); the baked noise
 *    is period-wrapped so the tiles are seamless
 *  - far fade: radiance slides toward the fog/horizon color and coverage
 *    fades to zero from 7 → 10 km so distant decks dissolve into the haze
 *
 * Wind is derived from the seed with the SAME formula as
 * CloudShadows.buildCloudCoverage (angle ≈ 2.6 rad WSW ± fbm wobble, 9 m/s)
 * so the raymarched deck drifts in lockstep with the baked ground-shadow
 * field when both receive the same seed. Determinism: seed/Rng only.
 */

import {
  ClampToEdgeWrapping,
  DataTexture,
  LinearFilter,
  RedFormat,
  RepeatWrapping,
  UnsignedByteType,
  Vector2,
  Vector3,
} from 'three';
import type { Node, WebGPURenderer } from 'three/webgpu';
import {
  Break,
  If,
  Loop,
  clamp,
  dot,
  exp,
  float,
  fract,
  mix,
  pow,
  screenUV,
  smoothstep,
  texture,
  uniform,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';
import { Rng } from '../core/Random.ts';
import { fbm2D, fbm3D, worley3D } from '../core/Noise.ts';

// TSL node aliases (@types/three generics carry swizzles/operators per type)
type NF = Node<'float'>;
type NI = Node<'int'>;
type NV2 = Node<'vec2'>;
type NV3 = Node<'vec3'>;

const BASE_RES = 64;
const DETAIL_RES = 32;
/** slice-atlas grids: BASE_RES slices in an 8×8 atlas, DETAIL_RES in 6×6 */
const BASE_GRID = 8;
const DETAIL_GRID = 6;
const WEATHER_RES = 256;
/** weather field world span (m) — wraps via manual fract beyond this */
const WEATHER_WORLD = 16000;
const CLOUD_BOTTOM = 900;
const CLOUD_TOP = 1500;
/** base/detail noise world tiling (m per texture repeat) */
const BASE_TILE = 2400;
const DETAIL_TILE = 420;
const STEPS = 24;
const SUN_TAP_M = 180;
/** cloud-layer wind speed (m/s) — matches CloudShadows.windSpeed */
const DRIFT_V = 9;
/** far fade band (m): radiance → fog color, alpha → 0 */
const FADE_START = 7000;
const FADE_END = 10000;
/** sky-ambient contribution scale (calibrated for ACES exposure 1.18) */
const AMBIENT_K = 1.05;

/** Dave Hoskins sinless vec2→float hash, [0,1) — stable across GPUs. */
function hash12(p: NV2): NF {
  const a = fract(vec3(p.x, p.y, p.x).mul(0.1031));
  const b = a.add(dot(a, a.yzx.add(33.33)));
  return fract(b.x.add(b.y).mul(b.z));
}

export class VolumetricClouds {
  /** 64³ density field as an 8×8 atlas of 64² slices (512² r8unorm) */
  private readonly baseNoise: DataTexture;
  /** 32³ erosion field as a 6×6 atlas of 32² slices (192² r8unorm) */
  private readonly detailNoise: DataTexture;
  /** r: coverage field, LAAS contrast stretch pre-baked */
  private readonly weatherMap: DataTexture;
  private readonly seed: number;

  /** weather clock (s) — CPU-owned so freezes are explicit */
  private readonly uTime = uniform(0);
  /** downwind field translation at t (m) = windDir · DRIFT_V · uTime */
  private readonly uDrift = uniform(new Vector2());
  private readonly uSunToward = uniform(new Vector3(0, 1, 0));
  private readonly uSunRadiance = uniform(new Vector3());
  private readonly uSkyAmbient = uniform(new Vector3());
  /** matches PostStack aerial-perspective horizon tone */
  private readonly uFogColor = uniform(new Vector3(0.62, 0.55, 0.42));
  /** seeded fbm domain offset for the weather bake */
  private readonly uWeatherOff = uniform(new Vector2());
  private readonly coverage = uniform(0.57);
  private readonly density = uniform(0.72);

  private readonly windX: number;
  private readonly windZ: number;
  private timeAcc = 0;

  constructor(seed: number, sunToward: Vector3, opts?: { skyAmbient?: Vector3; sunRadiance?: Vector3 }) {
    // wind: IDENTICAL derivation to CloudShadows.buildCloudCoverage so the
    // volumetric deck and the baked ground-shadow field drift together
    const ang = 2.6 + (fbm2D(seed * 0.001, 7.7, seed ^ 0x11, 2) - 0.5) * 0.8;
    this.windX = Math.cos(ang);
    this.windZ = Math.sin(ang);

    const rng = new Rng(seed >>> 0).fork('volumetric-clouds');
    this.uWeatherOff.value.set(rng.range(-100, 100), rng.range(-100, 100));

    this.uSunToward.value.copy(sunToward).normalize();
    this.uSunRadiance.value.copy(opts?.sunRadiance ?? new Vector3(1.0, 0.8, 0.58).multiplyScalar(3.4));
    this.uSkyAmbient.value.copy(opts?.skyAmbient ?? new Vector3(0.6, 0.68, 0.84).multiplyScalar(0.95));

    this.seed = seed >>> 0;

    // Plain sampled 2D textures, CPU-baked in init(): r8unorm is filterable,
    // needs no storage binding, and upload marks them fully initialized.
    const baseW = BASE_RES * BASE_GRID;
    const detailW = DETAIL_RES * DETAIL_GRID;
    this.baseNoise = new DataTexture(new Uint8Array(baseW * baseW), baseW, baseW);
    this.detailNoise = new DataTexture(new Uint8Array(detailW * detailW), detailW, detailW);
    this.weatherMap = new DataTexture(new Uint8Array(WEATHER_RES * WEATHER_RES), WEATHER_RES, WEATHER_RES);
    for (const tex of [this.baseNoise, this.detailNoise, this.weatherMap]) {
      tex.format = RedFormat;
      tex.type = UnsignedByteType;
      tex.magFilter = LinearFilter;
      tex.minFilter = LinearFilter;
      tex.generateMipmaps = false;
    }
    // weather wraps (16 km field repeats); atlases address tiles explicitly
    this.weatherMap.wrapS = this.weatherMap.wrapT = RepeatWrapping;
    this.baseNoise.wrapS = this.baseNoise.wrapT = ClampToEdgeWrapping;
    this.detailNoise.wrapS = this.detailNoise.wrapT = ClampToEdgeWrapping;
  }

  /** Atlas write: slice z lives at tile (z % grid, ⌊z / grid⌋). */
  private static atlasIndex(x: number, y: number, z: number, res: number, grid: number): number {
    const ax = (z % grid) * res + x;
    const ay = Math.floor(z / grid) * res + y;
    return ay * res * grid + ax;
  }

  /** Bake the three noise fields once on the CPU (call before first render). */
  async init(_renderer: WebGPURenderer): Promise<void> {
    const seed = this.seed;

    // --- base: perlin-worley remap (period-wrapped → seamless tiling) -------
    const N = BASE_RES;
    const baseData = this.baseNoise.image.data as Uint8Array;
    for (let z = 0; z < N; z++) {
      for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) {
          const px = ((x + 0.5) / N) * 8;
          const py = ((y + 0.5) / N) * 8;
          const pz = ((z + 0.5) / N) * 8;
          // value-noise fbm is flatter than gradient perlin — stretch it back
          // to the contrast the GPU bake had, or the deck thins to nothing
          const perlinRaw = fbm3D(px, py, pz, seed ^ 0x1a2b3, 8, 4);
          const perlin = Math.min(1, Math.max(0, (perlinRaw - 0.5) * 2.6 + 0.62));
          const w0 = 1 - worley3D(px * 0.5, py * 0.5, pz * 0.5, seed ^ 0x77aa1, 4);
          const w1 = 1 - worley3D(px, py, pz, seed ^ 0x77aa2, 8);
          const w2 = 1 - worley3D(px * 2, py * 2, pz * 2, seed ^ 0x77aa3, 16);
          const wfbm = w0 * 0.625 + w1 * 0.25 + w2 * 0.125;
          // remap perlin by worley (Schneider-style perlin-worley)
          const v = Math.min(1, Math.max(0, (perlin - (1 - wfbm)) / Math.max(1e-3, wfbm)));
          baseData[VolumetricClouds.atlasIndex(x, y, z, N, BASE_GRID)] = Math.round(v * 255);
        }
      }
    }
    this.baseNoise.needsUpdate = true;

    // --- detail: 2-octave worley erosion field ------------------------------
    const M = DETAIL_RES;
    const detailData = this.detailNoise.image.data as Uint8Array;
    for (let z = 0; z < M; z++) {
      for (let y = 0; y < M; y++) {
        for (let x = 0; x < M; x++) {
          const px = ((x + 0.5) / M) * 3;
          const py = ((y + 0.5) / M) * 3;
          const pz = ((z + 0.5) / M) * 3;
          const w0 = 1 - worley3D(px, py, pz, seed ^ 0x33cc1, 3);
          const w1 = 1 - worley3D(px * 2, py * 2, pz * 2, seed ^ 0x33cc2, 6);
          const d = w0 * 0.65 + w1 * 0.35;
          detailData[VolumetricClouds.atlasIndex(x, y, z, M, DETAIL_GRID)] = Math.round(
            Math.min(1, Math.max(0, d)) * 255,
          );
        }
      }
    }
    this.detailNoise.needsUpdate = true;

    // --- weather/coverage bake (16 km span, wraps seamlessly) ---------------
    const W = WEATHER_RES;
    const weatherData = this.weatherMap.image.data as Uint8Array;
    const offX = this.uWeatherOff.value.x;
    const offY = this.uWeatherOff.value.y;
    const span = WEATHER_WORLD / 5200;
    for (let y = 0; y < W; y++) {
      for (let x = 0; x < W; x++) {
        const wx = ((x + 0.5) / W - 0.5) * span + offX;
        const wy = ((y + 0.5) / W - 0.5) * span + offY;
        const rawFlat = fbm2D(wx, wy, seed ^ 0x5eed, 3, 2.2, 0.5);
        const raw = (rawFlat - 0.5) * 2.2 + 0.5; // value-noise variance stretch
        // contrast stretch baked in: dense cores + clear lanes (fbm hugs 0.5)
        const t = Math.min(1, Math.max(0, (raw - 0.3) / (0.78 - 0.3)));
        const v = t * t * (3 - 2 * t);
        weatherData[y * W + x] = Math.round(v * 255);
      }
    }
    this.weatherMap.needsUpdate = true;
  }

  /**
   * Advance the drift clock with GAME dt (freeze-safe: NaN / paused / clamped
   * so a background tab cannot teleport the deck). Never uses wall clock.
   */
  tick(dt: number): void {
    if (!Number.isFinite(dt) || dt <= 0) return;
    this.timeAcc += Math.min(dt, 0.1);
    this.uTime.value = this.timeAcc;
    this.uDrift.value.set(this.windX, this.windZ).multiplyScalar(this.timeAcc * DRIFT_V);
  }

  /**
   * TSL: trilinear sample of a slice-atlased 3D field. p is a fract-wrapped
   * vec3 in [0,1)³ (u,v = in-slice, w = slice axis). Two bilinear 2D taps at
   * the bracketing slices, mixed on the slice fraction. In-slice UVs are
   * inset half a texel so bilinear filtering never bleeds across tiles.
   */
  private sampleAtlas(tex: DataTexture, p: NV3, res: number, grid: number): NF {
    const zf = p.z.mul(res).sub(0.5);
    const z0 = zf.floor();
    const fz = zf.sub(z0);
    const z0w = z0.add(res).mod(res);
    const z1w = z0.add(1 + res).mod(res);
    const half = 0.5 / res;
    const uvIn = clamp(p.xy, half, 1 - half).div(grid);
    const tap = (slice: NF): NF => {
      const tx = slice.mod(grid);
      const ty = slice.div(grid).floor();
      const uv = uvIn.add(vec2(tx, ty).div(grid));
      return texture(tex, uv as unknown as ReturnType<typeof vec2>, 0).x as unknown as NF;
    };
    return mix(tap(z0w as unknown as NF), tap(z1w as unknown as NF), fz) as unknown as NF;
  }

  /**
   * Cloud density at a world position (m). detail=false for the cheap sun
   * taps (weather + base fetches only). All lookups fract-wrapped manually.
   */
  private sampleDensity(wp: NV3, detail: boolean): NF {
    const hNorm = wp.y.sub(CLOUD_BOTTOM).div(CLOUD_TOP - CLOUD_BOTTOM);
    const inLayer = smoothstep(0, 0.12, hNorm).mul(smoothstep(1, 0.55, hNorm));
    const drift = vec2(this.uDrift) as unknown as NV2;
    const xz = wp.xz.sub(drift);
    const wUv = xz.div(WEATHER_WORLD).add(0.5).fract();
    const weather = texture(this.weatherMap, wUv, 0).x;
    const cov = clamp(weather.sub(float(1).sub(float(this.coverage))), 0, 1).mul(2.2);
    const basePos = vec3(xz.x, wp.y, xz.y).div(BASE_TILE).fract() as unknown as NV3;
    const base = this.sampleAtlas(this.baseNoise, basePos, BASE_RES, BASE_GRID);
    let dens = clamp(base.mul(cov).sub(float(0.32).mul(hNorm.add(0.45))), 0, 1).mul(inLayer);
    if (detail) {
      // detail erodes at 1.35× the base drift — masses churn, not slide
      const xz2 = wp.xz.sub(drift.mul(1.35));
      const detPos = vec3(xz2.x, wp.y, xz2.y).div(DETAIL_TILE).fract() as unknown as NV3;
      const det = this.sampleAtlas(this.detailNoise, detPos, DETAIL_RES, DETAIL_GRID);
      dens = clamp(dens.sub(det.mul(0.22).mul(float(1).sub(dens))), 0, 1);
    }
    return dens.mul(float(this.density));
  }

  /**
   * TSL: raymarch the layer for a world ray. Args are TSL nodes: origin
   * (vec3, m), dir (unit vec3), maxDist (float, m). Returns a vec4 node of
   * PREMULTIPLIED radiance + coverage: composite as scene·(1−a) + rgb.
   * Build inside a post Fn — uses screenUV for the static dither.
   */
  march(originNode: unknown, dirNode: unknown, maxDistNode: unknown): unknown {
    const camPos = originNode as NV3;
    const dir = dirNode as NV3;
    const maxDistM = maxDistNode as NF;
    const sunDir = vec3(this.uSunToward as unknown as NV3).normalize();

    // slab intersection — dir.y forced finite (float mask + mix; bool
    // .select() is broken in post contexts) so degenerate rays stay NaN-free
    const dyOk = dir.y.abs().greaterThan(1e-5).toFloat();
    const dySafe = mix(float(1e-5), dir.y, dyOk);
    const t0 = float(CLOUD_BOTTOM).sub(camPos.y).div(dySafe);
    const t1 = float(CLOUD_TOP).sub(camPos.y).div(dySafe);
    const tEnterRaw = t0.min(t1);
    const tExitRaw = t0.max(t1);
    const insideMask = camPos.y.greaterThan(CLOUD_BOTTOM).and(camPos.y.lessThan(CLOUD_TOP)).toFloat();
    const tEnter = mix(tEnterRaw.max(0), float(0), insideMask);
    const tExit = tExitRaw.min(maxDistM).min(FADE_END + 1500);
    const valid = tExit.greaterThan(tEnter).and(tEnter.lessThan(FADE_END));

    const seg = tExit.sub(tEnter).div(STEPS);
    const trans = float(1).toVar();
    const light = vec3(0).toVar();

    // per-pixel STATIC spatial dither — deliberately NO per-frame advance
    // (the game has TAA but the cloud edge must not depend on it)
    const jit = hash12(screenUV.mul(vec2(911.3, 423.7)) as unknown as NV2);

    // dual-lobe Henyey–Greenstein + isotropic multiple-scatter floor
    const nu = dir.dot(sunDir);
    const hg = (g: number): NF => {
      const gg = g * g;
      return float((1 - gg) / (4 * Math.PI)).div(pow(float(1 + gg).sub(nu.mul(2 * g)), 1.5));
    };
    const phase = hg(0.62).mul(0.75).add(hg(-0.18).mul(0.25)).add(0.14);
    const sunRad = vec3(this.uSunRadiance as unknown as NV3);
    const ambient = vec3(this.uSkyAmbient as unknown as NV3);

    If(valid, () => {
      Loop(STEPS, ({ i: si }: { readonly i: NI }) => {
        const t = tEnter.add(float(si).add(jit).mul(seg));
        const sp = camPos.add(dir.mul(t));
        const dens = this.sampleDensity(sp, true);
        If(dens.greaterThan(0.002), () => {
          // sun self-occlusion: 2 coarse taps toward the sun
          const lTau = float(0).toVar();
          for (let ls = 1; ls <= 2; ls++) {
            const lp = sp.add(sunDir.mul(ls * SUN_TAP_M));
            lTau.addAssign(this.sampleDensity(lp, false).mul(SUN_TAP_M));
          }
          const sunVis = exp(lTau.mul(-0.04));
          const powder = float(1).sub(exp(dens.mul(-22)));
          // ambient sees less sky toward the cloud base
          const hn = clamp(sp.y.sub(CLOUD_BOTTOM).div(CLOUD_TOP - CLOUD_BOTTOM), 0, 1);
          const S = sunRad
            .mul(sunVis.mul(phase))
            .add(ambient.mul(hn.mul(0.55).add(0.45)).mul(AMBIENT_K))
            .mul(powder.mul(0.75).add(0.25));
          const stepT = exp(dens.mul(seg).mul(-0.052));
          light.addAssign(S.mul(trans).mul(float(1).sub(stepT)));
          trans.mulAssign(stepT);
        });
        If(trans.lessThan(0.02), () => {
          Break();
        });
      });
    });

    // far fade: apparent color slides toward the fog tone while coverage
    // fades out over 7→10 km (premultiplied-consistent formulation)
    const alphaRaw = float(1).sub(trans);
    const vis = smoothstep(float(FADE_START), float(FADE_END), tEnter.max(0)).oneMinus();
    const fogC = vec3(this.uFogColor as unknown as NV3);
    const rgb = mix(fogC.mul(alphaRaw), light, vis).mul(vis);
    return vec4(rgb, alphaRaw.mul(vis));
  }
}
