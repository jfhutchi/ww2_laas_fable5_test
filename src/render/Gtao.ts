/**
 * GTAO layer — faithful port of three 0.184 GTAONode's fragment math
 * (examples/jsm/tsl/display/GTAONode.js) so it can live inside the merged
 * half-res MRT pass (HalfResMrt.ts) instead of its own render pass. Same
 * magic-square noise texture, slice/step loops, horizon math, and uniform
 * semantics — verify against the pinned source on any three upgrade.
 *
 * Deliberate differences from stock, all output-affecting fixes (LAAS):
 * - same-texel sample rejection: past a few hundred meters the world-space
 *   radius projects below one depth texel; the sample lands on the center's
 *   OWN texel, passes the thickness test with a quantization-dominated
 *   direction (normalize(≈0)) and drives cosHorizons → 1 = "fully occluded"
 *   → AO crushes to 0 on far grazing surfaces (flat fields near the
 *   horizon, grazing water). A same-texel sample carries no horizon
 *   information — reject it.
 * - clamp cosHorizons to [-1, 1]: f32 dot(viewDir, normalize(δ)) can read
 *   1+ε at grazing → sqrt(1−cos²) = NaN AO.
 * - stock discards sky fragments onto a white-cleared RT; an MRT pass can't
 *   discard (it would kill the other attachments) → ao = 1 branch instead
 *   (sky test tolerates both depth conventions: cleared far = 0 or 1).
 * - normals derived from depth (getNormalFromDepth), not a normal MRT:
 *   material normals carry far-detail perturbation that disagrees with the
 *   depth geometry — GTAO's cones bend into the surface = black facets.
 *
 * Camera matrices are EXPLICIT Matrix4 uniforms with a per-frame sync():
 * inside post/quad passes the TSL camera builtins bind to the quad's ortho
 * camera, not the scene camera (LAAS-verified trap).
 */

import { DataTexture, Matrix4, RepeatWrapping, Vector3 } from 'three';
import type { PerspectiveCamera } from 'three';
import type { Node } from 'three/webgpu';
import {
  Fn,
  If,
  Loop,
  PI,
  abs,
  acos,
  add,
  clamp,
  cos,
  cross,
  div,
  dot,
  exp2,
  float,
  floor,
  getNormalFromDepth,
  getScreenPosition,
  getViewPosition,
  int,
  mat3,
  max,
  mix,
  mul,
  normalize,
  pow,
  screenSize,
  screenUV,
  sin,
  smoothstep,
  sqrt,
  sub,
  texture,
  textureSize,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';

// TSL node aliases — @types/three 0.184 types nodes generically
// (Node<'vec3'> carries the vec3 swizzles/operators); bare Node has none.
type NF = Node<'float'>;
type NI = Node<'int'>;
type NV2 = Node<'vec2'>;
type NV3 = Node<'vec3'>;
type NV4 = Node<'vec4'>;

// LAAS terrain tuning: GTAO defaults are mesh-viewer scale — 16 samples
// cost ~50 ms/frame on terrain vistas. 8 samples, 1.6 m radius, softer
// distance falloff; thickness/exponent/scale stay at stock defaults.
const GTAO_SAMPLES = 8;
const GTAO_RADIUS = 1.6;
const GTAO_DISTANCE_FALLOFF = 0.6;
const GTAO_THICKNESS = 1;
const GTAO_DISTANCE_EXPONENT = 1;
const GTAO_SCALE = 1;

interface DepthTexLike {
  sample(uv: unknown): unknown;
  value: unknown;
}

export interface GtaoLayer {
  /** float AO node (1 = unoccluded) for a HalfResMrt entry */
  node: unknown;
  /** copy the scene camera's projection matrices into the layer uniforms — call once per frame */
  sync: (camera: PerspectiveCamera) => void;
}

/**
 * Builds the AO fragment expression for the merged half-res pass.
 * `depthNode` is the full-res scene depth PassTextureNode; `resolutionUniform`
 * is a vec2 uniform of the half-res pass dimensions (the orchestrator
 * pre-creates it and aliases HalfResMrtNode.resolution's Vector2 into it) —
 * drives the noise tiling exactly like stock GTAONode's resolution.
 */
export function gtaoLayer(depthNode: unknown, resolutionUniform: unknown): GtaoLayer {
  const depthTex = depthNode as DepthTexLike;
  const resolution = resolutionUniform as NV2;

  const uRadius = uniform(GTAO_RADIUS);
  const uThickness = uniform(GTAO_THICKNESS);
  const uDistanceExponent = uniform(GTAO_DISTANCE_EXPONENT);
  const uDistanceFallOff = uniform(GTAO_DISTANCE_FALLOFF);
  const uScale = uniform(GTAO_SCALE);
  const uSamples = uniform(GTAO_SAMPLES);
  // explicit scene-camera matrices, fed by sync() — see header
  const uProj = uniform(new Matrix4());
  const uProjInv = uniform(new Matrix4());
  const noiseNode = texture(generateMagicSquareNoise());

  const node = Fn((): NF => {
    const uvNode = uv();
    const sampleDepth = (uvS: unknown): NF =>
      (depthTex.sample(uvS) as NV4).r as unknown as NF;

    const result = float(1).toVar();
    const depth = sampleDepth(uvNode).toVar();

    // stock: depth.greaterThanEqual(1.0).discard() onto a white-cleared RT.
    // Sky = cleared depth; tolerate either convention (0 or 1 at far).
    const isSky = depth.lessThanEqual(1e-7).or(depth.greaterThanEqual(0.9999999));
    If(isSky.not(), () => {
      const viewPosition = getViewPosition(
        uvNode,
        depth,
        uProjInv as unknown as Parameters<typeof getViewPosition>[2],
      ).toVar();
      const viewNormal = (
        getNormalFromDepth(
          uvNode,
          depthTex.value as Parameters<typeof getNormalFromDepth>[1],
          uProjInv as unknown as Parameters<typeof getNormalFromDepth>[2],
        ) as unknown as NV3
      ).toVar();
      // own depth texel — used to reject degenerate self-samples
      // (deviation from stock, see below)
      const ownTexel = floor(uvNode.mul(screenSize)).toVar();

      const radiusToUse = uRadius;

      const noiseResolution = textureSize(noiseNode, int(0));
      const noiseUv = vec2(uvNode.x, uvNode.y.oneMinus()).mul(
        resolution.div(noiseResolution as unknown as NV2),
      );

      const noiseTexel = noiseNode.sample(noiseUv) as unknown as NV4;
      const randomVec = noiseTexel.xyz.mul(2.0).sub(1.0);
      const tangent = vec3(randomVec.xy, 0.0).normalize();
      const bitangent = vec3(tangent.y.mul(-1.0), tangent.x, 0.0);
      const kernelMatrix = mat3(tangent, bitangent, vec3(0.0, 0.0, 1.0));

      const DIRECTIONS = (uSamples as unknown as NF).lessThan(30).select(3, 5).toVar();
      const STEPS = add((uSamples as unknown as NF), DIRECTIONS.sub(1)).div(DIRECTIONS).toVar();

      const ao = float(0).toVar();

      Loop(
        { start: int(0), end: DIRECTIONS as unknown as NI, type: 'int', condition: '<' },
        ({ i }: { readonly i: NI }) => {
          // stock adds _temporalDirection here — always 0 with temporal
          // filtering off (stock default and our configuration), omitted
          const angle = float(i).div(float(DIRECTIONS as unknown as NF)).mul(PI).toVar();
          const sampleDir = vec4(
            cos(angle),
            sin(angle),
            0,
            add(0.5, mul(0.5, noiseTexel.w)),
          ).toVar();
          sampleDir.xyz = normalize(kernelMatrix.mul(sampleDir.xyz));

          const viewDir = normalize(viewPosition.xyz.negate()).toVar();
          const sliceBitangent = normalize(cross(sampleDir.xyz, viewDir)).toVar();
          const sliceTangent = cross(sliceBitangent, viewDir);
          const normalInSlice = normalize(
            viewNormal.sub(sliceBitangent.mul(dot(viewNormal, sliceBitangent))),
          );

          const tangentToNormalInSlice = cross(normalInSlice, sliceBitangent).toVar();
          const cosHorizons = vec2(
            dot(viewDir, tangentToNormalInSlice),
            dot(viewDir, tangentToNormalInSlice.negate()),
          ).toVar();

          Loop(
            // 'name' missing from @types LoopNodeObjectParameter but required
            // at runtime: it names the loop var AND the destructure key
            { end: STEPS as unknown as NI, type: 'int', name: 'j', condition: '<' } as unknown as Parameters<typeof Loop>[0],
            (({ j }: { readonly j: NI }) => {
              const sampleViewOffset = sampleDir.xyz
                .mul(radiusToUse as unknown as NF)
                .mul(sampleDir.w)
                .mul(
                  pow(
                    div(float(j).add(1.0), float(STEPS as unknown as NF)),
                    uDistanceExponent as unknown as NF,
                  ),
                );

              // x
              const sampleScreenPositionX = getScreenPosition(
                viewPosition.add(sampleViewOffset),
                uProj as unknown as Parameters<typeof getScreenPosition>[1],
              ).toVar();
              const sampleDepthX = sampleDepth(sampleScreenPositionX).toVar();
              const sampleSceneViewPositionX = getViewPosition(
                sampleScreenPositionX,
                sampleDepthX,
                uProjInv as unknown as Parameters<typeof getViewPosition>[2],
              ).toVar();
              const viewDeltaX = sampleSceneViewPositionX.sub(viewPosition).toVar();
              // sub-texel rejection (deviation from stock, horizon-black
              // fix): past a few hundred meters the world-space radius
              // projects below one depth texel — the sample lands on the
              // center's OWN texel, passes the thickness test with a
              // quantization-dominated direction (normalize(≈0)) and drives
              // cosHorizons → 1 = "fully occluded". A same-texel sample
              // carries no horizon information; near-field offsets span
              // many texels and are unaffected.
              const offTexelX = dot(
                abs(floor(sampleScreenPositionX.mul(screenSize)).sub(ownTexel)),
                vec2(1, 1),
              ).greaterThan(0.5);
              If(abs(viewDeltaX.z).lessThan(uThickness as unknown as NF).and(offTexelX), () => {
                const sampleCosHorizon = dot(viewDir, normalize(viewDeltaX));
                cosHorizons.x.addAssign(
                  max(
                    0,
                    mul(
                      sampleCosHorizon.sub(cosHorizons.x),
                      mix(
                        1.0,
                        float(2.0).div(float(j).add(2)),
                        uDistanceFallOff as unknown as NF,
                      ),
                    ),
                  ),
                );
              });

              // y
              const sampleScreenPositionY = getScreenPosition(
                viewPosition.sub(sampleViewOffset),
                uProj as unknown as Parameters<typeof getScreenPosition>[1],
              ).toVar();
              const sampleDepthY = sampleDepth(sampleScreenPositionY).toVar();
              const sampleSceneViewPositionY = getViewPosition(
                sampleScreenPositionY,
                sampleDepthY,
                uProjInv as unknown as Parameters<typeof getViewPosition>[2],
              ).toVar();
              const viewDeltaY = sampleSceneViewPositionY.sub(viewPosition).toVar();
              const offTexelY = dot(
                abs(floor(sampleScreenPositionY.mul(screenSize)).sub(ownTexel)),
                vec2(1, 1),
              ).greaterThan(0.5);
              If(abs(viewDeltaY.z).lessThan(uThickness as unknown as NF).and(offTexelY), () => {
                const sampleCosHorizon = dot(viewDir, normalize(viewDeltaY));
                cosHorizons.y.addAssign(
                  max(
                    0,
                    mul(
                      sampleCosHorizon.sub(cosHorizons.y),
                      mix(
                        1.0,
                        float(2.0).div(float(j).add(2)),
                        uDistanceFallOff as unknown as NF,
                      ),
                    ),
                  ),
                );
              });
            }) as unknown as Parameters<typeof Loop>[1],
          );

          // f32 guard (deviation from stock, which carries the hazard):
          // dot(viewDir, normalize(δ)) can read 1+ε at grazing → cos² > 1
          // → sqrt(negative) = NaN AO
          cosHorizons.assign(clamp(cosHorizons as unknown as NF, -1, 1) as unknown as NV2);
          // stock: sqrt(sub(1.0, cosHorizons*cosHorizons)) — oneMinus is the
          // same WGSL; @types sqrt is float-only, runtime handles vec2
          const sinHorizons = (
            sqrt(cosHorizons.mul(cosHorizons).oneMinus() as unknown as NF) as unknown as NV2
          ).toVar();
          const nx = dot(normalInSlice, sliceTangent);
          const ny = dot(normalInSlice, viewDir);
          const nxb = mul(
            0.5,
            acos(cosHorizons.y)
              .sub(acos(cosHorizons.x))
              .add(sinHorizons.x.mul(cosHorizons.x).sub(sinHorizons.y.mul(cosHorizons.y))),
          );
          const nyb = mul(
            0.5,
            sub(2.0, cosHorizons.x.mul(cosHorizons.x)).sub(
              cosHorizons.y.mul(cosHorizons.y),
            ),
          );
          const occlusion = nx.mul(nxb).add(ny.mul(nyb));
          ao.addAssign(occlusion);
        },
      );

      ao.assign(clamp(ao.div(DIRECTIONS as unknown as NF), 0, 1));
      ao.assign(pow(ao, uScale as unknown as NF));
      result.assign(ao);
    });

    return result;
  })();

  const sync = (camera: PerspectiveCamera): void => {
    uProj.value.copy(camera.projectionMatrix);
    uProjInv.value.copy(camera.projectionMatrixInverse);
  };

  return { node, sync };
}

/**
 * Joint-bilateral upsample of a half-res AO attachment against full-res
 * depth, for the full-res composite pass. Plain bilinear at 0.5 scale
 * prints row streaks on grazing terrain; this is what makes half res viable.
 *
 * 4 half-res taps weighted exp2(−3.5·|Δz_view|) against the full-res
 * center depth, with a GATED fallback for bilateral collapse: on grazing
 * slopes near the horizon a half-res texel spans tens of meters of view
 * depth, every tap rejects, and acc/ε fabricates ao=0 — a black horizon
 * band after the AO multiply. Support-free pixels blend back to the plain
 * 4-tap average; wsum > 0.02 (any tap within ~2 m) keeps the bilateral
 * result EXACT — zero deviation on healthy pixels. A global additive
 * weight floor is NOT equivalent: it perturbs the blend on every
 * partially-weighted pixel (measured ~1% AO wash on hero geometry).
 *
 * Texel math uses screenSize (this runs at drawing-buffer resolution);
 * PassTextureNode.size() returns 0 on MRT attachments.
 */
export function bilateralUpsample(halfTex: unknown, fullDepth: unknown, projInv: unknown): unknown {
  const src = halfTex as DepthTexLike;
  const depthTex = fullDepth as DepthTexLike;
  const projInvNode = projInv as Parameters<typeof getViewPosition>[2];

  return Fn((): NF => {
    // half-res texel size in UV (the pass renders at 0.5× drawing buffer)
    const halfTexel = vec2(1).div(screenSize.mul(0.5));
    const dC = (depthTex.sample(screenUV) as NV4).x;
    const zC = getViewPosition(screenUV, dC, projInvNode).z;
    const acc = float(0).toVar();
    const avg = float(0).toVar();
    const wsum = float(1e-4).toVar();
    for (const [ox, oy] of [
      [-0.5, -0.5],
      [0.5, -0.5],
      [-0.5, 0.5],
      [0.5, 0.5],
    ] as const) {
      const uvi = screenUV.add(halfTexel.mul(vec2(ox, oy)));
      const ai = (src.sample(uvi) as NV4).x;
      const zi = getViewPosition(uvi, (depthTex.sample(uvi) as NV4).x, projInvNode).z;
      const w = exp2(zi.sub(zC).abs().mul(-3.5));
      acc.addAssign(ai.mul(w));
      avg.addAssign(ai);
      wsum.addAssign(w);
    }
    return mix(avg.mul(0.25), acc.div(wsum), smoothstep(0.002, 0.02, wsum));
  })();
}

/**
 * Stock GTAONode noise — magic-square angles baked to a 5×5 repeat texture.
 * Copied verbatim from GTAONode.js (not exported there).
 */
function generateMagicSquareNoise(size = 5): DataTexture {
  const noiseSize = Math.floor(size) % 2 === 0 ? Math.floor(size) + 1 : Math.floor(size);
  const magicSquare = generateMagicSquare(noiseSize);
  const noiseSquareSize = magicSquare.length;
  const data = new Uint8Array(noiseSquareSize * 4);

  for (let inx = 0; inx < noiseSquareSize; ++inx) {
    const iAng = magicSquare[inx] ?? 0;
    const angle = (2 * Math.PI * iAng) / noiseSquareSize;
    const randomVec = new Vector3(Math.cos(angle), Math.sin(angle), 0).normalize();
    data[inx * 4] = (randomVec.x * 0.5 + 0.5) * 255;
    data[inx * 4 + 1] = (randomVec.y * 0.5 + 0.5) * 255;
    data[inx * 4 + 2] = 127;
    data[inx * 4 + 3] = 255;
  }

  const noiseTexture = new DataTexture(data, noiseSize, noiseSize);
  noiseTexture.wrapS = RepeatWrapping;
  noiseTexture.wrapT = RepeatWrapping;
  noiseTexture.needsUpdate = true;
  return noiseTexture;
}

function generateMagicSquare(size: number): number[] {
  const noiseSize = Math.floor(size) % 2 === 0 ? Math.floor(size) + 1 : Math.floor(size);
  const noiseSquareSize = noiseSize * noiseSize;
  const magicSquare = Array<number>(noiseSquareSize).fill(0);
  let i = Math.floor(noiseSize / 2);
  let j = noiseSize - 1;

  for (let num = 1; num <= noiseSquareSize; ) {
    if (i === -1 && j === noiseSize) {
      j = noiseSize - 2;
      i = 0;
    } else {
      if (j === noiseSize) j = 0;
      if (i < 0) i = noiseSize - 1;
    }
    if (magicSquare[i * noiseSize + j] !== 0) {
      j -= 2;
      i++;
      continue;
    } else {
      magicSquare[i * noiseSize + j] = num++;
    }
    j++;
    i--;
  }

  return magicSquare;
}
