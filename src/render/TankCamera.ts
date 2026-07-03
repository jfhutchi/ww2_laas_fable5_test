/**
 * Third-person over-the-shoulder tank camera. Follows a hull transform,
 * orbits with the aim yaw/pitch, spring-lagged for a heavy vehicle feel.
 * Camera distance is toggleable (C key cycles shoulder presets).
 */

import { PerspectiveCamera, Vector3 } from 'three';
import { clamp, damp } from '../core/MathUtil.ts';

export interface TankCameraTarget {
  /** Hull position (world). */
  position: Vector3;
  /** Hull yaw (radians). */
  yaw: number;
}

const PRESETS = [
  { back: 9.5, up: 3.6, side: 1.4, fov: 52 },
  { back: 14, up: 5.2, side: 1.8, fov: 48 },
  { back: 6.5, up: 2.6, side: 1.1, fov: 58 },
] as const;

export class TankCamera {
  readonly camera: PerspectiveCamera;

  /** Aim direction controlled by the mouse (world yaw/pitch). */
  aimYaw = 0;
  aimPitch = -0.06;

  private presetIndex = 0;
  private pos = new Vector3();
  private look = new Vector3();
  private shake = 0;
  private shakeTime = 0;

  sampleHeight: (x: number, z: number) => number = () => 0;

  constructor(aspect: number) {
    this.camera = new PerspectiveCamera(52, aspect, 0.3, 6000);
  }

  cyclePreset(): void {
    this.presetIndex = (this.presetIndex + 1) % PRESETS.length;
  }

  addAim(dx: number, dy: number): void {
    // world yaw: direction = (cos yaw, sin yaw); mouse right turns clockwise
    this.aimYaw += dx * 0.0028;
    this.aimPitch = clamp(this.aimPitch - dy * 0.002, -0.42, 0.3);
  }

  /** Recoil/impact kick. */
  addShake(strength: number): void {
    this.shake = Math.min(1.5, this.shake + strength);
  }

  snapBehind(target: TankCameraTarget): void {
    this.aimYaw = target.yaw;
    this.aimPitch = -0.06;
    this.solve(target, 1, true);
  }

  update(dt: number, target: TankCameraTarget): void {
    this.solve(target, dt, false);
  }

  private solve(target: TankCameraTarget, dt: number, snap: boolean): void {
    const p = PRESETS[this.presetIndex] ?? PRESETS[0];
    // aim direction in world convention: (cos yaw, sin yaw)
    const dirX = Math.cos(this.aimYaw);
    const dirZ = Math.sin(this.aimYaw);
    const latX = -dirZ; // left of the aim direction
    const latZ = dirX;

    // Desired eye: behind the aim direction, offset up and to the shoulder.
    const ex = target.position.x - dirX * p.back + latX * p.side;
    const ez = target.position.z - dirZ * p.back + latZ * p.side;
    let ey = target.position.y + p.up + Math.sin(-this.aimPitch) * p.back * 0.5;
    const ground = this.sampleHeight(ex, ez);
    ey = Math.max(ey, ground + 1.2);

    // Aim point: far along the aim direction from the turret.
    const range = 120;
    const ax = target.position.x + dirX * Math.cos(this.aimPitch) * range;
    const az = target.position.z + dirZ * Math.cos(this.aimPitch) * range;
    const ay = target.position.y + 2.2 + Math.sin(this.aimPitch) * range;

    if (snap) {
      this.pos.set(ex, ey, ez);
      this.look.set(ax, ay, az);
    } else {
      const l = 18;
      this.pos.set(
        damp(this.pos.x, ex, l, dt),
        damp(this.pos.y, ey, l, dt),
        damp(this.pos.z, ez, l, dt),
      );
      this.look.set(
        damp(this.look.x, ax, l * 1.5, dt),
        damp(this.look.y, ay, l * 1.5, dt),
        damp(this.look.z, az, l * 1.5, dt),
      );
    }

    // decaying shake
    if (this.shake > 0.001) {
      this.shakeTime += dt * 34;
      const s = this.shake * 0.22;
      this.pos.x += Math.sin(this.shakeTime * 1.13) * s;
      this.pos.y += Math.sin(this.shakeTime * 1.71 + 1.3) * s * 0.7;
      this.shake = damp(this.shake, 0, 6, dt);
    }

    this.camera.fov = p.fov;
    this.camera.updateProjectionMatrix();
    this.camera.position.copy(this.pos);
    this.camera.lookAt(this.look);
  }
}
