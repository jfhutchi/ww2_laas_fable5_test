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
} from 'three';
import type { GraphicsPreset } from '../app/Config.ts';

export class Lighting {
  readonly sun: DirectionalLight;
  readonly hemi: HemisphereLight;
  /** Direction pointing FROM the sun TOWARD the scene (normalized). */
  readonly sunDir = new Vector3();

  private shadowSpan = 180;

  constructor(scene: Scene, preset: GraphicsPreset) {
    // Late afternoon: sun ~24 degrees above horizon, WSW.
    const azimuth = 2.35; // radians from +Z
    const elevation = 0.42;
    this.sunDir
      .set(-Math.sin(azimuth) * Math.cos(elevation), -Math.sin(elevation), -Math.cos(azimuth) * Math.cos(elevation))
      .normalize();

    this.sun = new DirectionalLight(new Color(1.0, 0.8, 0.58), 3.6);
    this.sun.position.copy(this.sunDir).multiplyScalar(-420);
    this.sun.castShadow = true;
    const mapSize = preset === 'low' ? 2048 : preset === 'high' ? 4096 : 4096;
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
    this.hemi = new HemisphereLight(new Color(0.6, 0.68, 0.84), new Color(0.44, 0.39, 0.29), 0.8);
    scene.add(this.hemi);

    // Counter-sun bounce fill so backlit hulls/figures keep their read.
    const fill = new DirectionalLight(new Color(0.72, 0.74, 0.8), 0.5);
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
