/**
 * Volumetric cumulus layer, ported from the LAAS benchmark (src/sky/Clouds.ts)
 * and scaled for this game:
 *
 *  - single altitude band 900–1500 m (below LAAS's alpine 1250–1900 band)
 *  - base perlin–worley density in a 64³ HalfFloat/Red Storage3DTexture and a
 *    32³ worley erosion texture, each baked ONCE by a compute kernel
 *    (instanceIndex → texel, mx_fractal_noise_float + mx_worley_noise_float
 *    Schneider-style remap)
 *  - a 256² weather/coverage field over 16 km (3-octave fbm with the LAAS
 *    contrast stretch smoothstep(0.3,0.78) baked in, seeded domain offset)
 *  - march(): 24 fixed front-to-back steps with a per-pixel STATIC spatial
 *    dither (hash12(screenUV·k) — no per-frame advance, we do not lean on
 *    TAA), 2 sun taps at 180 m spacing (exp(-0.04·τ)), dual-lobe HG phase
 *    (g = 0.62 / −0.18) + 0.14 isotropic floor, powder 1−exp(−22ρ), Beer
 *    step exp(−0.052·ρ·seg), early Break at transmittance < 0.02
 *  - every storage-texture lookup wraps its domain with a manual .fract()
 *    (sampler wrap modes are untrustworthy on storage textures)
 *  - far fade: radiance slides toward the fog/horizon color and coverage
 *    fades to zero from 7 → 10 km so distant decks dissolve into the haze
 *
 * Wind is derived from the seed with the SAME formula as
 * CloudShadows.buildCloudCoverage (angle ≈ 2.6 rad WSW ± fbm wobble, 9 m/s)
 * so the raymarched deck drifts in lockstep with the baked ground-shadow
 * field when both receive the same seed. Determinism: seed/Rng only.
 */

import { HalfFloatType, RedFormat, Vector2, Vector3 } from 'three';
import { Storage3DTexture, StorageTexture } from 'three/webgpu';
import type { Node, WebGPURenderer } from 'three/webgpu';
import {
  Break,
  Fn,
  If,
  Loop,
  Return,
  clamp,
  dot,
  exp,
  float,
  fract,
  instanceIndex,
  mix,
  mx_fractal_noise_float,
  mx_worley_noise_float,
  pow,
  screenUV,
  smoothstep,
  texture,
  texture3D,
  textureStore,
  uniform,
  uvec2,
  uvec3,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';
import { Rng } from '../core/Random.ts';
import { fbm2D } from '../core/Noise.ts';

// TSL node aliases (@types/three generics carry swizzles/operators per type)
type NF = Node<'float'>;
type NI = Node<'int'>;
type NV2 = Node<'vec2'>;
type NV3 = Node<'vec3'>;

const BASE_RES = 64;
const DETAIL_RES = 32;
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
const AMBIENT_K = 0.6;

/** Dave Hoskins sinless vec2→float hash, [0,1) — stable across GPUs. */
function hash12(p: NV2): NF {
  const a = fract(vec3(p.x, p.y, p.x).mul(0.1031));
  const b = a.add(dot(a, a.yzx.add(33.33)));
  return fract(b.x.add(b.y).mul(b.z));
}

export class VolumetricClouds {
  private readonly baseNoise: Storage3DTexture;
  private readonly detailNoise: Storage3DTexture;
  /** r: coverage field, LAAS contrast stretch pre-baked */
  private readonly weatherMap: StorageTexture;

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
  private readonly coverage = uniform(0.62);
  private readonly density = uniform(0.85);

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
    this.uSkyAmbient.value.copy(opts?.skyAmbient ?? new Vector3(0.6, 0.68, 0.84).multiplyScalar(0.8));

    this.baseNoise = new Storage3DTexture(BASE_RES, BASE_RES, BASE_RES);
    this.baseNoise.type = HalfFloatType;
    this.baseNoise.format = RedFormat;
    this.detailNoise = new Storage3DTexture(DETAIL_RES, DETAIL_RES, DETAIL_RES);
    this.detailNoise.type = HalfFloatType;
    this.detailNoise.format = RedFormat;
    this.weatherMap = new StorageTexture(WEATHER_RES, WEATHER_RES);
    this.weatherMap.type = HalfFloatType;
    this.weatherMap.generateMipmaps = false;
  }

  /** Bake the three noise textures once (compute; call before first render). */
  async init(renderer: WebGPURenderer): Promise<void> {
    // --- base: perlin-worley remap (tileable via domain fract) --------------
    const N = BASE_RES;
    const baseK = Fn(() => {
      const i = instanceIndex;
      If(i.greaterThanEqual(N * N * N), () => {
        Return();
      });
      const x = i.mod(N);
      const y = i.div(N).mod(N);
      const z = i.div(N * N);
      const p = vec3(float(x), float(y), float(z)).add(0.5).div(N);
      const pw = p.mul(4);
      const perlin = mx_fractal_noise_float(pw.mul(2), 4, 2.0, 0.55, 1).mul(0.5).add(0.5);
      const w0 = float(1).sub(clamp(mx_worley_noise_float(pw, 1), 0, 1));
      const w1 = float(1).sub(clamp(mx_worley_noise_float(pw.mul(2.03).add(19.7), 1), 0, 1));
      const w2 = float(1).sub(clamp(mx_worley_noise_float(pw.mul(4.01).add(47.3), 1), 0, 1));
      const wfbm = w0.mul(0.625).add(w1.mul(0.25)).add(w2.mul(0.125));
      // remap perlin by worley (Schneider-style perlin-worley)
      const pwv = clamp(perlin.sub(wfbm.oneMinus()).div(wfbm.max(1e-3)), 0, 1);
      textureStore(this.baseNoise, uvec3(x.toUint(), y.toUint(), z.toUint()), vec4(pwv, 0, 0, 1)).toWriteOnly();
    })().compute(N * N * N);
    baseK.setName('cloudBaseNoise');
    await renderer.computeAsync(baseK);

    // --- detail: 2-octave worley erosion field ------------------------------
    const M = DETAIL_RES;
    const detailK = Fn(() => {
      const i = instanceIndex;
      If(i.greaterThanEqual(M * M * M), () => {
        Return();
      });
      const x = i.mod(M);
      const y = i.div(M).mod(M);
      const z = i.div(M * M);
      const p = vec3(float(x), float(y), float(z)).add(0.5).div(M);
      const w0 = float(1).sub(clamp(mx_worley_noise_float(p.mul(3), 1), 0, 1));
      const w1 = float(1).sub(clamp(mx_worley_noise_float(p.mul(6.02).add(7.7), 1), 0, 1));
      const d = w0.mul(0.65).add(w1.mul(0.35));
      textureStore(this.detailNoise, uvec3(x.toUint(), y.toUint(), z.toUint()), vec4(d, 0, 0, 1)).toWriteOnly();
    })().compute(M * M * M);
    detailK.setName('cloudDetailNoise');
    await renderer.computeAsync(detailK);

    // --- weather/coverage bake (16 km span, seam wraps far off-map) ---------
    const W = WEATHER_RES;
    const weatherK = Fn(() => {
      const i = instanceIndex;
      If(i.greaterThanEqual(W * W), () => {
        Return();
      });
      const x = i.mod(W);
      const y = i.div(W);
      const uv01 = vec2(float(x).add(0.5), float(y).add(0.5)).div(W);
      const wUv = uv01
        .sub(0.5)
        .mul(WEATHER_WORLD / 5200)
        .add(vec2(this.uWeatherOff) as unknown as NV2);
      const raw = mx_fractal_noise_float(wUv, 3, 2.2, 0.5, 1).mul(0.5).add(0.5);
      // contrast stretch baked in: dense cores + clear lanes (fbm hugs 0.5)
      const v = smoothstep(0.3, 0.78, raw);
      textureStore(this.weatherMap, uvec2(x.toUint(), y.toUint()), vec4(v, 0, 0, 1)).toWriteOnly();
    })().compute(W * W);
    weatherK.setName('cloudWeather');
    await renderer.computeAsync(weatherK);
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
    const base = texture3D(this.baseNoise, vec3(xz.x, wp.y, xz.y).div(BASE_TILE).fract(), 0).x;
    let dens = clamp(base.mul(cov).sub(float(0.32).mul(hNorm.add(0.45))), 0, 1).mul(inLayer);
    if (detail) {
      // detail erodes at 1.35× the base drift — masses churn, not slide
      const xz2 = wp.xz.sub(drift.mul(1.35));
      const det = texture3D(this.detailNoise, vec3(xz2.x, wp.y, xz2.y).div(DETAIL_TILE).fract(), 0).x;
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
