/**
 * Analytic camera-reprojection velocity for TRAA.
 *
 * The stock velocity MRT is unusable here (LAAS-verified: it is blind to
 * displaced/instanced geometry and clears to garbage on sky), so we feed
 * TRAANode a duck-typed velocity source through its documented seam:
 * TRAANode samples its constructor velocityNode exactly once, via
 * `velocityNode.load(closestPositionTexel)`. We reconstruct world position
 * from depth and reproject through the previous frame's view/projection —
 * exact for the static world (99% of pixels); moving units are handled by
 * TRAA's variance clipping.
 */

import { Matrix4, type PerspectiveCamera } from 'three';
import { Fn, getViewPosition, screenSize, uniform, vec2, vec4 } from 'three/tsl';

type TexelNode = ReturnType<typeof vec2>;

export interface VelocityReproject {
  /** Duck-typed velocity source for traa(...). */
  velocityNode: { load: (texel: TexelNode) => ReturnType<typeof vec4> };
  /** Call at render time, after all camera mutation, before post.render(). */
  sync: (camera: PerspectiveCamera) => void;
  /** Seed prev=current on the next sync (camera swap / teleport flush). */
  resetHistory: () => void;
}

export function makeVelocityReproject(
  depthNode: { load: (texel: TexelNode) => { x: ReturnType<typeof vec4>['x'] } },
): VelocityReproject {
  const uProjInv = uniform(new Matrix4());
  const uCamWorld = uniform(new Matrix4());
  const uPrevView = uniform(new Matrix4());
  const uPrevProj = uniform(new Matrix4());

  // per-chain storage of the matrices used for the last rendered frame
  const lastView = new Matrix4();
  const lastProj = new Matrix4();
  let first = true;

  const velReproject = Fn(([texel]: [TexelNode]) => {
    const uv = vec2(texel).add(0.5).div(screenSize);
    const d = depthNode.load(texel).x;
    const viewPos = getViewPosition(uv, d, uProjInv);
    const world = uCamWorld.mul(vec4(viewPos, 1));
    const prevClip = uPrevProj.mul(uPrevView.mul(world));
    const prevNdc = prevClip.xy.div(prevClip.w);
    // getViewPosition flips v internally (uv top-left vs NDC y-up): flip back
    const uvPrev = vec2(prevNdc.x.mul(0.5).add(0.5), prevNdc.y.mul(0.5).add(0.5).oneMinus());
    // ndcCur − ndcPrev in y-up NDC (VelocityNode convention: TRAA maps ×(0.5,−0.5))
    return uv.sub(uvPrev).mul(vec2(2, -2));
  });

  return {
    velocityNode: {
      load: (texel: TexelNode) => vec4(velReproject(texel), 0, 1),
    },
    sync: (camera: PerspectiveCamera) => {
      camera.updateMatrixWorld();
      if (first) {
        first = false;
        uPrevView.value.copy(camera.matrixWorldInverse);
        uPrevProj.value.copy(camera.projectionMatrix);
      } else {
        // previous frame's matrices are whatever we used last render
        uPrevView.value.copy(lastView);
        uPrevProj.value.copy(lastProj);
      }
      lastView.copy(camera.matrixWorldInverse);
      lastProj.copy(camera.projectionMatrix);
      uProjInv.value.copy(camera.projectionMatrixInverse);
      uCamWorld.value.copy(camera.matrixWorld);
    },
    resetHistory: () => {
      first = true;
    },
  };
}
