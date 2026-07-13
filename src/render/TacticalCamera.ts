/**
 * RTS-style tactical camera rig: an orbit around a ground focus point with
 * pan (WASD/edge), rotate (Q/E + middle-drag), zoom (wheel), and pose
 * bookmarks. All motion is smoothed with exponential damping.
 */

import { PerspectiveCamera, Vector3 } from 'three';
import type { Input } from '../core/Input.ts';
import { clamp, damp, angleDelta } from '../core/MathUtil.ts';
import type { CameraPose } from '../app/Config.ts';
import { cameraRelativePan } from './TacticalPan.ts';

const MIN_DIST = 18;
const MAX_DIST = 220;
const MIN_PITCH = 0.62; // radians below horizontal
const MAX_PITCH = 1.35;
const PAN_SPEED = 0.9; // world units per second per distance unit
const EDGE_PX = 8;

export interface TacticalBookmark {
  x: number;
  z: number;
  dist: number;
  yaw: number;
}

export class TacticalCamera {
  readonly camera: PerspectiveCamera;

  // target state (smoothed toward)
  focusX = 0;
  focusZ = 0;
  dist = 95;
  yaw = 0.6;
  pitch = 0.98;

  // rendered state
  private curFocusX = 0;
  private curFocusZ = 0;
  private curDist = 95;
  private curYaw = 0.6;
  private curPitch = 0.98;

  /** Bounds of the playable area the camera may roam. */
  boundsMin = -760;
  boundsMax = 760;

  /** Ground height sampler, replaced when the world exists. */
  sampleHeight: (x: number, z: number) => number = () => 0;

  private bookmarks = new Map<number, TacticalBookmark>();
  enabled = true;
  edgePanEnabled = true;

  constructor(aspect: number) {
    this.camera = new PerspectiveCamera(45, aspect, 0.5, 6000);
    this.snap();
  }

  setPose(p: CameraPose): void {
    // Pose format: x,y,z = eye position; yaw/pitch aim; fov.
    // Reconstruct rig params: focus is where the view ray hits ground height ~0.
    this.camera.fov = p.fov;
    this.camera.updateProjectionMatrix();
    const dirY = -Math.sin(p.pitch);
    const t = dirY < -0.05 ? (p.y - this.sampleHeight(p.x, p.z)) / -dirY : 60;
    const dirX = Math.sin(p.yaw) * Math.cos(p.pitch);
    const dirZ = -Math.cos(p.yaw) * Math.cos(p.pitch);
    this.focusX = p.x + dirX * t;
    this.focusZ = p.z + dirZ * t;
    this.dist = clamp(t, MIN_DIST, MAX_DIST + 400);
    this.yaw = p.yaw + Math.PI; // rig yaw is from focus toward eye
    this.pitch = clamp(p.pitch, MIN_PITCH, MAX_PITCH);
    this.snap();
  }

  /** Current eye pose for ?cam= round-tripping (P key). */
  getPose(): CameraPose {
    const eye = this.camera.position;
    return {
      x: round2(eye.x),
      y: round2(eye.y),
      z: round2(eye.z),
      yaw: round2(this.curYaw - Math.PI),
      pitch: round2(this.curPitch),
      fov: this.camera.fov,
    };
  }

  focusOn(x: number, z: number, dist?: number): void {
    this.focusX = x;
    this.focusZ = z;
    if (dist !== undefined) this.dist = clamp(dist, MIN_DIST, MAX_DIST);
  }

  saveBookmark(slot: number): void {
    this.bookmarks.set(slot, { x: this.focusX, z: this.focusZ, dist: this.dist, yaw: this.yaw });
  }

  recallBookmark(slot: number): boolean {
    const b = this.bookmarks.get(slot);
    if (!b) return false;
    this.focusX = b.x;
    this.focusZ = b.z;
    this.dist = b.dist;
    this.yaw = b.yaw;
    return true;
  }

  update(dt: number, input: Input, viewportW: number, viewportH: number): void {
    if (this.enabled) {
      // --- zoom
      const wheel = input.takeWheel();
      if (wheel !== 0) {
        this.dist = clamp(this.dist * Math.pow(1.0012, wheel), MIN_DIST, MAX_DIST);
      }

      // --- rotate: Q/E keys and middle-mouse drag
      const rotSpeed = 1.6;
      if (input.key('Q')) this.yaw += rotSpeed * dt;
      if (input.key('E')) this.yaw -= rotSpeed * dt;
      const mm = (input.pointer.buttons & 4) !== 0;
      if (mm) {
        const mv = input.takeMouseMove();
        this.yaw -= mv.dx * 0.005;
        this.pitch = clamp(this.pitch + mv.dy * 0.004, MIN_PITCH, MAX_PITCH);
      }

      // --- pan: WASD/arrows + edge pan
      let strafe = 0;
      let forward = 0;
      if (input.key('W') || input.key('ArrowUp')) forward += 1;
      if (input.key('S') || input.key('ArrowDown')) forward -= 1;
      if (input.key('A') || input.key('ArrowLeft')) strafe -= 1;
      if (input.key('D') || input.key('ArrowRight')) strafe += 1;
      if (this.edgePanEnabled && !document.pointerLockElement) {
        const p = input.pointer;
        if (p.x >= 0 && p.y >= 0 && p.x <= viewportW && p.y <= viewportH) {
          if (p.x < EDGE_PX) strafe -= 1;
          else if (p.x > viewportW - EDGE_PX) strafe += 1;
          if (p.y < EDGE_PX) forward += 1;
          else if (p.y > viewportH - EDGE_PX) forward -= 1;
        }
      }
      if (strafe !== 0 || forward !== 0) {
        const pan = cameraRelativePan(this.yaw, strafe, forward);
        const len = Math.hypot(pan.x, pan.z);
        const s = (PAN_SPEED * this.dist * dt) / len;
        this.focusX += pan.x * s;
        this.focusZ += pan.z * s;
      }

      this.focusX = clamp(this.focusX, this.boundsMin, this.boundsMax);
      this.focusZ = clamp(this.focusZ, this.boundsMin, this.boundsMax);
    }

    // --- smooth toward targets
    const l = 14;
    this.curFocusX = damp(this.curFocusX, this.focusX, l, dt);
    this.curFocusZ = damp(this.curFocusZ, this.focusZ, l, dt);
    this.curDist = damp(this.curDist, this.dist, l, dt);
    this.curYaw += angleDelta(this.curYaw, this.yaw) * (1 - Math.exp(-l * dt));
    this.curPitch = damp(this.curPitch, this.pitch, l, dt);

    this.apply();
  }

  private snap(): void {
    this.curFocusX = this.focusX;
    this.curFocusZ = this.focusZ;
    this.curDist = this.dist;
    this.curYaw = this.yaw;
    this.curPitch = this.pitch;
    this.apply();
  }

  private apply(): void {
    const groundY = this.sampleHeight(this.curFocusX, this.curFocusZ);
    const horiz = Math.cos(this.curPitch) * this.curDist;
    const eyeX = this.curFocusX + Math.sin(this.curYaw) * horiz;
    const eyeZ = this.curFocusZ + Math.cos(this.curYaw) * horiz;
    const eyeY = groundY + Math.sin(this.curPitch) * this.curDist;
    // keep the eye above terrain
    const minY = this.sampleHeight(eyeX, eyeZ) + 4;
    this.camera.position.set(eyeX, Math.max(eyeY, minY), eyeZ);
    this.camera.lookAt(new Vector3(this.curFocusX, groundY, this.curFocusZ));
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
