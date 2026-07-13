/**
 * Sun/sky lighting for the golden late-afternoon Normandy look.
 * Warm directional sun with cool hemispheric skylight fill so shadows are
 * never black; the shadow frustum follows the active camera focus.
 */

import {
  DirectionalLight,
  HemisphereLight,
  Color,
  Scene,
  Vector3,
  OrthographicCamera,
  type PerspectiveCamera,
} from 'three';
import { CSMShadowNode } from 'three/addons/csm/CSMShadowNode.js';
import type { GraphicsPreset } from '../app/Config.ts';
import { SUN_AZIMUTH, SUN_ELEVATION } from '../world/WorldConst.ts';

export class Lighting {
  readonly sun: DirectionalLight;
  readonly hemi: HemisphereLight;
  /** Direction pointing FROM the sun TOWARD the scene (normalized). */
  readonly sunDir = new Vector3();
  /** Cascaded shadow rig (high/ultra); null on low preset. */
  private csm: CSMShadowNode | null = null;

  private shadowSpan = 180;

  /** CSM fits itself to the ACTIVE view camera — call on mode switches. */
  setShadowCamera(camera: PerspectiveCamera): void {
    if (!this.csm) return;
    const rig = this.csm as unknown as {
      camera: PerspectiveCamera | null;
      mainFrustum?: unknown;
      updateFrustums?: () => void;
    };
    // CSMShadowNode._init only fires while camera === null (it self-assigns
    // the first build camera) — pre-setting it would skip init entirely.
    // Only refit for genuine camera SWAPS after the node is live.
    if (!rig.mainFrustum) return;
    rig.camera = camera;
    camera.updateProjectionMatrix();
    rig.updateFrustums?.();
  }

  constructor(scene: Scene, preset: GraphicsPreset) {
    // Golden hour, WSW — MUST match WorldConst so shadows agree with the
    // HDRI sky, cloud shadows and the post stack's sun lobe.
    const azimuth = SUN_AZIMUTH;
    const elevation = SUN_ELEVATION;
    this.sunDir
      .set(-Math.sin(azimuth) * Math.cos(elevation), -Math.sin(elevation), -Math.cos(azimuth) * Math.cos(elevation))
      .normalize();

    this.sun = new DirectionalLight(new Color(1.0, 0.79, 0.54), 4.2);
    this.sun.position.copy(this.sunDir).multiplyScalar(-420);
    this.sun.castShadow = true;

    // Single camera-following map. (A 3-cascade CSMShadowNode port was
    // attempted and produced no usable cascade maps under the PostProcessing
    // scene-pass pipeline — LAAS needed a custom CsmCached + near/far fixes
    // for the same reason. Parked; see docs/DELTA.md ledger.)
    const mapSize = preset === 'low' ? 2048 : 4096;
    this.sun.shadow.mapSize.set(mapSize, mapSize);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.35;
    const cam = this.sun.shadow.camera as OrthographicCamera;
    cam.near = 40;
    cam.far = 1200;
    this.setShadowSpan(150);
    scene.add(this.sun);
    scene.add(this.sun.target);

    // Sky fill: cool blue sky, warm earthy ground bounce. Keeps shadow floors lifted.
    // Environment IBL (render/Environment.ts) carries most ambient now;
    // the hemisphere is a low-level floor so nothing can ever crush black.
    this.hemi = new HemisphereLight(new Color(0.6, 0.68, 0.84), new Color(0.44, 0.39, 0.29), 0.28);
    scene.add(this.hemi);

    // Counter-sun bounce fill so backlit hulls/figures keep their read.
    const fill = new DirectionalLight(new Color(0.72, 0.74, 0.8), 0.45);
    fill.position.copy(this.sunDir).multiplyScalar(360); // opposite the sun
    fill.castShadow = false;
    scene.add(fill);
    scene.add(fill.target);
  }

  /** Size of the shadow map footprint in world units. */
  setShadowSpan(span: number): void {
    this.shadowSpan = span;
    const cam = this.sun.shadow.camera as OrthographicCamera;
    cam.left = -span;
    cam.right = span;
    cam.top = span;
    cam.bottom = -span;
    cam.updateProjectionMatrix();
  }

  /** Keep the shadow frustum centred on what the camera looks at. */
  follow(focusX: number, focusZ: number): void {
    if (this.csm) return; // CSM self-fits to the view camera
    // Snap to shadow-texel-sized increments to avoid crawling edges.
    const texel = (this.shadowSpan * 2) / this.sun.shadow.mapSize.x;
    const step = Math.max(texel * 8, 1);
    const fx = Math.round(focusX / step) * step;
    const fz = Math.round(focusZ / step) * step;
    this.sun.target.position.set(fx, 0, fz);
    this.sun.position.set(fx, 0, fz).addScaledVector(this.sunDir, -420);
    this.sun.target.updateMatrixWorld();
  }
}
