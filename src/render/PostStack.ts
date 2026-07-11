/**
 * WebGPU post-processing stack (high/ultra presets), per gameplay camera:
 *
 *   scene pass (MRT: output+normal) → GTAO multiply → analytic aerial
 *   perspective (per-channel Rayleigh/Mie extinction, altitude-dependent
 *   boundary haze, sun-side warm in-scatter) → bloom → golden-hour grade
 *   (white balance, teal shadows / orange highlights split toning,
 *   saturation, filmic contrast) → vignette.
 *
 * Camera matrices are fed as explicit uniforms synced at render time —
 * inside PostProcessing nodes the builtin camera nodes resolve to the
 * post quad's ortho camera, not the scene camera (LAAS-verified trap).
 */

import { Matrix4, Vector2, Vector3, type PerspectiveCamera, type Scene } from 'three';
import { PostProcessing, type WebGPURenderer } from 'three/webgpu';
import {
  Fn,
  dot,
  exp,
  float,
  getViewPosition,
  mix,
  mrt,
  output,
  pass,
  pow,
  screenUV,
  smoothstep,
  texture,
  uniform,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { gtaoLayer, bilateralUpsample } from './Gtao.ts';
import { HalfResMrtNode } from './HalfResMrt.ts';
import type { VolumetricClouds } from './VolumetricClouds.ts';
import { traa } from 'three/addons/tsl/display/TRAANode.js';
import { SUN_AZIMUTH, SUN_ELEVATION } from '../world/WorldConst.ts';
import type { CloudCoverage } from './CloudShadows.ts';
import { makeVelocityReproject, type VelocityReproject } from './VelocityReproject.ts';

interface Chain {
  post: PostProcessing;
  camera: PerspectiveCamera;
  sync: () => void;
  rep: VelocityReproject;
  traaNode: ReturnType<typeof traa>;
}

// aerial-perspective tuning (per-kilometre coefficients)
const BETA_R = new Vector3(0.0058, 0.0136, 0.0331).multiplyScalar(0.62);
const BETA_M = 0.0105;
const HAZE_H_KM = 0.4; // scale height of the boundary haze

export class PostStack {
  private chains: Chain[] = [];
  private uDrift = uniform(new Vector3(0, 0, 0));
  private clouds: CloudCoverage;

  constructor(renderer: WebGPURenderer, scene: Scene, cameras: PerspectiveCamera[], clouds: CloudCoverage, vclouds: VolumetricClouds | null) {
    this.clouds = clouds;
    // direction TOWARD the sun (Lighting.sunDir points sun→scene)
    const sunToward = new Vector3(
      Math.sin(SUN_AZIMUTH) * Math.cos(SUN_ELEVATION),
      Math.sin(SUN_ELEVATION),
      Math.cos(SUN_AZIMUTH) * Math.cos(SUN_ELEVATION),
    );

    // cloud-shadow lookup shared by both chains; the sun's slant offsets the
    // shadow footprint from the (virtual) cloud position
    const slantX = (-sunToward.x / Math.max(0.2, sunToward.y)) * 1200;
    const slantZ = (-sunToward.z / Math.max(0.2, sunToward.y)) * 1200;
    const uDrift = this.uDrift;
    // TSL expression nodes: the published types are narrower than runtime,
    // so this helper is typed structurally loose on purpose
    type NF = ReturnType<typeof float>;
    const cloudShadowAt = (xIn: unknown, zIn: unknown): NF => {
      const x = xIn as NF;
      const z = zIn as NF;
      const u = x.add(uDrift.x).add(slantX).div(clouds.span);
      const v = z.add(uDrift.z).add(slantZ).div(clouds.span);
      const c = texture(clouds.texture, vec2(u, v)).r;
      // 0.55 floor ≈ ambient share when the sun is occluded
      return float(1).sub(c.mul(0.45)) as unknown as NF;
    };

    for (const camera of cameras) {
      const scenePass = pass(scene, camera);
      scenePass.setMRT(mrt({ output }));
      const scenePassColor = scenePass.getTextureNode('output');
      const scenePassDepth = scenePass.getTextureNode('depth');

      // ---- explicit scene-camera uniforms (post nodes see the quad camera)
      const uCamPos = uniform(new Vector3());
      const uProjInv = uniform(new Matrix4());
      const uCamWorld = uniform(new Matrix4());
      const uSunToward = uniform(sunToward.clone());
      const sync = (): void => {
        camera.updateMatrixWorld();
        uCamPos.value.copy(camera.position);
        uProjInv.value.copy(camera.projectionMatrixInverse);
        uCamWorld.value.copy(camera.matrixWorld);
        gtao.sync(camera);
      };

      // ---- fixed GTAO (LAAS port: same-texel rejection + NaN clamp) and the
      // volumetric cloud march share one half-res MRT quad pass
      const aoRes = uniform(new Vector2(2, 2));
      const gtao = gtaoLayer(scenePassDepth, aoRes);
      const cloudEntryNode =
        vclouds === null
          ? null
          : Fn(() => {
              const dHalf = scenePassDepth.x;
              const isSkyH = dHalf.lessThanEqual(1e-7).or(dHalf.greaterThanEqual(0.9999999)).toFloat();
              const viewMidH = getViewPosition(screenUV, float(0.5), uProjInv);
              const dirWH = uCamWorld.mul(vec4(viewMidH.normalize(), 0)).xyz.normalize();
              const hitDist = getViewPosition(screenUV, dHalf, uProjInv).length();
              const maxDist = mix(hitDist, float(30000), isSkyH);
              return vclouds.march(uCamPos, dirWH, maxDist) as ReturnType<typeof vec4>;
            })();
      const halfEntries: { name: string; node: unknown; red?: boolean }[] = [
        { name: 'ao', node: gtao.node, red: true },
      ];
      if (cloudEntryNode !== null) halfEntries.push({ name: 'clouds', node: cloudEntryNode });
      const halfPass = new HalfResMrtNode(halfEntries, 0.5);
      aoRes.value = halfPass.resolution.value; // live-aliased (LAAS pattern)
      const aoFloat = bilateralUpsample(halfPass.getTextureNode('ao'), scenePassDepth, uProjInv) as ReturnType<typeof float>;
      const aoAmount = vec4(vec3(aoFloat), 1);
      const lit = scenePassColor.mul(aoAmount);

      // ---- analytic aerial perspective (replaces linear scene fog)
      const hazed = Fn(() => {
        const d = scenePassDepth.x;
        // ray direction from a fixed mid depth — far-plane depth degenerates
        // through the inverse projection (LAAS-verified)
        const viewMid = getViewPosition(screenUV, float(0.5), uProjInv);
        const dirW = uCamWorld.mul(vec4(viewMid.normalize(), 0)).xyz.normalize();
        const viewPos = getViewPosition(screenUV, d, uProjInv);
        const distKm = viewPos.length().div(1000);
        const worldPos = uCamWorld.mul(vec4(viewPos, 1)).xyz;

        // average ray altitude in km drives the Mie/boundary-haze density
        const hAvgKm = uCamPos.y
          .add(dirW.y.mul(distKm.mul(1000)).mul(0.5))
          .div(1000)
          .max(0.002);
        const mieDensity = float(BETA_M).mul(exp(hAvgKm.div(HAZE_H_KM).negate()));
        const tauR = vec3(BETA_R.x, BETA_R.y, BETA_R.z).mul(distKm);
        const tau = tauR.add(vec3(mieDensity.mul(distKm)));
        // @types exp() is float-only; evaluate per channel (runtime-equivalent)
        const nTau = tau.negate();
        const transmit = vec3(exp(nTau.x), exp(nTau.y), exp(nTau.z));

        // drifting cloud shadow: darken ground under cloud cover
        const shadowSample = cloudShadowAt(worldPos.x, worldPos.z);

        // in-scatter: horizon tone warmed toward the sun by a forward lobe,
        // modulated by cloud cover at the ray midpoint → crepuscular shafts
        const midX = uCamPos.x.add(worldPos.x).mul(0.5);
        const midZ = uCamPos.z.add(worldPos.z).mul(0.5);
        const shaft = cloudShadowAt(midX, midZ);
        const sunAmount = pow(dot(dirW, uSunToward).max(0), 5.5).mul(shaft);
        const horizonC = vec3(0.62, 0.55, 0.42);
        const sunC = vec3(1.05, 0.74, 0.44);
        const inscatter = mix(horizonC, sunC, sunAmount);
        const one = vec3(1, 1, 1);

        // sky mask as float math (select() proved unreliable here)
        const skyMask = d.lessThanEqual(1e-7).or(d.greaterThanEqual(0.9999999)).toFloat();
        const shadowed = lit.rgb.mul(mix(float(1), shadowSample, skyMask.oneMinus()));
        const fogged = shadowed.mul(transmit).add(inscatter.mul(one.sub(transmit)));
        const outRgb = mix(fogged, lit.rgb, skyMask);
        return vec4(outRgb, lit.a);
      })();

      // ---- temporal AA on the hazed HDR image (pre-bloom, LAAS order);
      // velocity is analytic camera reprojection through the duck-type seam
      const rep = makeVelocityReproject(
        scenePassDepth as unknown as Parameters<typeof makeVelocityReproject>[0],
      );
      // ---- volumetric cloud composite (premultiplied): scene*(1-a) + rgb
      const withClouds =
        vclouds === null
          ? hazed
          : Fn(() => {
              const cl = halfPass.getTextureNode('clouds') as unknown as ReturnType<typeof vec4>;
              return vec4(hazed.rgb.mul(cl.a.oneMinus()).add(cl.rgb), hazed.a);
            })();

      const traaNode = traa(
        withClouds,
        scenePassDepth,
        rep.velocityNode as unknown as Parameters<typeof traa>[2],
        camera,
      );
      // runtime nodes carry operator methods via the shader-node proxy;
      // the published TRAANode type omits them
      const stabilized = traaNode as unknown as ReturnType<typeof vec4>;

      // ---- bloom on the stabilized image (sun glare, tracers, fires)
      const bloomPass = bloom(stabilized, 0.32, 0.35, 0.8);
      const bloomed = stabilized.add(bloomPass);

      // ---- golden-hour grade: WB → split tone → saturation → contrast
      const LUMA = vec3(0.2126, 0.7152, 0.0722);
      const graded = Fn(() => {
        const c = bloomed.rgb.mul(vec3(1.12, 1.0, 0.86)).toVar();
        const lum = dot(c, LUMA).toVar();
        // cool teal shadows (richer, reaches deeper)
        c.assign(mix(c, c.mul(vec3(0.78, 0.9, 1.18)), smoothstep(0.5, 0.06, lum).mul(0.5)));
        // warm gold highlights
        c.assign(mix(c, c.mul(vec3(1.2, 1.02, 0.78)), smoothstep(0.3, 1.1, lum).mul(0.42)));
        // saturation (kept gentle — the reference reads muted, never lime)
        c.assign(mix(vec3(dot(c, LUMA)), c, float(1.07)));
        // filmic contrast around scene-linear mid-gray (per channel — see exp note)
        const k = c.div(0.18).max(0.0);
        c.assign(vec3(pow(k.x, 1.26), pow(k.y, 1.26), pow(k.z, 1.26)).mul(0.18));
        return vec4(c, 1);
      })();

      // ---- vignette
      const vignette = screenUV.sub(0.5).length().mul(0.9).oneMinus().clamp(0.62, 1);

      const post = new PostProcessing(renderer);
      post.outputNode = graded.mul(vignette);
      this.chains.push({ post, camera, sync, rep, traaNode });
    }
  }

  /** Flush TAA history on camera swaps (setSize(1,1) forces a clean restart). */
  onCameraSwap(): void {
    for (const chain of this.chains) {
      (chain.traaNode as unknown as { setSize(w: number, h: number): void }).setSize(1, 1);
      chain.rep.resetHistory();
    }
  }

  /** Advance the cloud-field drift (called with sim time each frame). */
  setDriftTime(t: number): void {
    this.uDrift.value.set(this.clouds.windX * this.clouds.windSpeed * t, 0, this.clouds.windZ * this.clouds.windSpeed * t);
  }

  /** Render the chain whose camera is active this frame. */
  render(camera: PerspectiveCamera): boolean {
    for (const chain of this.chains) {
      if (chain.camera === camera) {
        chain.sync();
        chain.rep.sync(chain.camera);
        chain.post.render();
        return true;
      }
    }
    return false;
  }
}
