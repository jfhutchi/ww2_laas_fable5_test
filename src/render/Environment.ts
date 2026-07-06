/**
 * Procedural image-based lighting: a small equirectangular sky radiance map
 * painted from the same golden-hour palette as the sky dome (warm glow lobe
 * around the sun, deep blue zenith, luminous horizon band, dark earthy
 * lower hemisphere). Assigned as scene.environment so every standard
 * material picks up directional sky response — cool blue in shadow,
 * warm wrap on sun-facing surfaces — instead of flat hemisphere fill.
 */

import {
  Color,
  DataTexture,
  EquirectangularReflectionMapping,
  LinearFilter,
  RGBAFormat,
  FloatType,
  Scene,
} from 'three';
import { SUN_AZIMUTH, SUN_ELEVATION } from '../world/WorldConst.ts';

const W = 128;
const H = 64;

export function buildEnvironment(scene: Scene, intensity = 1): void {
  const sunX = Math.sin(SUN_AZIMUTH) * Math.cos(SUN_ELEVATION);
  const sunY = Math.sin(SUN_ELEVATION);
  const sunZ = Math.cos(SUN_AZIMUTH) * Math.cos(SUN_ELEVATION);

  const data = new Float32Array(W * H * 4);
  const zenith = new Color(0.16, 0.3, 0.62);
  const horizon = new Color(0.95, 0.78, 0.52);
  const groundNear = new Color(0.3, 0.27, 0.2);
  const groundDeep = new Color(0.16, 0.15, 0.11);
  const sunWarm = new Color(1.0, 0.72, 0.4);
  const c = new Color();

  for (let y = 0; y < H; y++) {
    // v: 0 = top of map = +Y (up)
    const phi = (y / (H - 1)) * Math.PI; // 0 (up) … PI (down)
    const dy = Math.cos(phi);
    const sinPhi = Math.sin(phi);
    for (let x = 0; x < W; x++) {
      const theta = (x / W) * Math.PI * 2 - Math.PI;
      const dx = -Math.sin(theta) * sinPhi;
      const dz = -Math.cos(theta) * sinPhi;

      if (dy >= 0) {
        // sky: zenith → horizon gradient
        const t = Math.pow(1 - dy, 1.6);
        c.copy(zenith).lerp(horizon, t);
        // warm scatter lobe around the sun
        const d = dx * sunX + dy * sunY + dz * sunZ;
        const lobe = Math.pow(Math.max(0, d), 6);
        c.lerp(sunWarm, lobe * 0.75);
        // bright sun core (drives warm specular/wrap)
        if (d > 0.995) c.setRGB(6, 4.6, 3.2);
        else if (d > 0.985) c.lerp(new Color(3, 2.4, 1.7), (d - 0.985) / 0.01);
      } else {
        // ground bounce hemisphere: warm earthy near the horizon, dark below
        const t = Math.min(1, -dy * 2.4);
        c.copy(groundNear).lerp(groundDeep, t);
        // sun-side ground is a bit warmer (light bouncing off lit fields)
        const dGround = dx * sunX + dz * sunZ;
        if (dGround > 0) c.lerp(new Color(0.42, 0.34, 0.22), dGround * 0.35 * (1 - t));
      }

      const i = (y * W + x) * 4;
      data[i] = c.r;
      data[i + 1] = c.g;
      data[i + 2] = c.b;
      data[i + 3] = 1;
    }
  }

  const tex = new DataTexture(data, W, H, RGBAFormat, FloatType);
  tex.mapping = EquirectangularReflectionMapping;
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearFilter;
  tex.needsUpdate = true;
  scene.environment = tex;
  scene.environmentIntensity = intensity;
}
