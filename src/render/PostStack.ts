/**
 * WebGPU post-processing stack (high/ultra presets): scene pass with
 * normal MRT → GTAO multiplied into the lit color → bloom (tracers, muzzle
 * flashes, fires, the sun disc) → subtle vignette. One chain per gameplay
 * camera; App renders the chain for the active mode.
 */

import type { PerspectiveCamera, Scene } from 'three';
import { PostProcessing, type WebGPURenderer } from 'three/webgpu';
import { mrt, output, pass, screenUV, transformedNormalView, vec3, vec4 } from 'three/tsl';
import { ao } from 'three/addons/tsl/display/GTAONode.js';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';

interface Chain {
  post: PostProcessing;
  camera: PerspectiveCamera;
}

export class PostStack {
  private chains: Chain[] = [];

  constructor(renderer: WebGPURenderer, scene: Scene, cameras: PerspectiveCamera[]) {
    for (const camera of cameras) {
      const scenePass = pass(scene, camera);
      scenePass.setMRT(
        mrt({
          output,
          normal: transformedNormalView,
        }),
      );
      const scenePassColor = scenePass.getTextureNode('output');
      const scenePassNormal = scenePass.getTextureNode('normal');
      const scenePassDepth = scenePass.getTextureNode('depth');

      const aoPass = ao(scenePassDepth, scenePassNormal, camera);
      aoPass.resolutionScale = 0.5;
      // GTAO writes occlusion into R only — broadcast before multiplying
      const aoAmount = vec4(vec3(aoPass.getTextureNode().r), 1);
      const lit = scenePassColor.mul(aoAmount);

      const bloomPass = bloom(lit, 0.35, 0.32, 0.82);
      const vignette = screenUV
        .sub(0.5)
        .length()
        .mul(0.9)
        .oneMinus()
        .clamp(0.62, 1);

      const post = new PostProcessing(renderer);
      post.outputNode = lit.add(bloomPass).mul(vignette);
      this.chains.push({ post, camera });
    }
  }

  /** Render the chain whose camera is active this frame. */
  render(camera: PerspectiveCamera): boolean {
    for (const chain of this.chains) {
      if (chain.camera === camera) {
        chain.post.render();
        return true;
      }
    }
    return false;
  }
}
