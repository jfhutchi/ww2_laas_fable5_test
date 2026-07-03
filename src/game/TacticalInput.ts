/**
 * Tactical mode interaction: unit picking, drag-rectangle multi-select,
 * context orders (right-click move / attack), hotkey command modes
 * (A attack-move, G attack-ground), and control groups. All orders flow
 * through Commands — the same path the test API uses.
 */

import type { PerspectiveCamera } from 'three';
import { Vector3 } from 'three';
import type { ClickEvent, Input } from '../core/Input.ts';
import type { GameState } from './GameState.ts';
import type { Commands } from './Commands.ts';
import type { Ground } from '../world/Ground.ts';
import { ARCHETYPES } from './Types.ts';

const PICK_RADIUS_PX = 30;

export class TacticalInput {
  private rectEl: HTMLDivElement;
  private v = new Vector3();
  private origin = new Vector3();
  private dir = new Vector3();

  constructor(
    parent: HTMLElement,
    private gs: GameState,
    private commands: Commands,
    private ground: Ground,
  ) {
    this.rectEl = document.createElement('div');
    this.rectEl.id = 'select-rect';
    parent.append(this.rectEl);
  }

  destroy(): void {
    this.rectEl.remove();
  }

  /** Called every frame from App with the drained click queue. */
  update(input: Input, clicks: ClickEvent[], camera: PerspectiveCamera, viewportW: number, viewportH: number): void {
    // live drag rectangle
    if (input.pointer.dragging && (input.pointer.buttons & 1) !== 0) {
      const x0 = Math.min(input.pointer.dragStartX, input.pointer.x);
      const y0 = Math.min(input.pointer.dragStartY, input.pointer.y);
      const x1 = Math.max(input.pointer.dragStartX, input.pointer.x);
      const y1 = Math.max(input.pointer.dragStartY, input.pointer.y);
      this.rectEl.style.display = 'block';
      this.rectEl.style.left = `${x0}px`;
      this.rectEl.style.top = `${y0}px`;
      this.rectEl.style.width = `${x1 - x0}px`;
      this.rectEl.style.height = `${y1 - y0}px`;
    } else {
      this.rectEl.style.display = 'none';
    }

    for (const click of clicks) {
      if (click.button === 0) {
        if (!click.isClick) {
          // rectangle select
          this.rectSelect(click, camera, viewportW, viewportH);
          continue;
        }
        // armed command modes consume the left click
        if (this.commands.mode === 'attack-move' || this.commands.mode === 'attack-ground') {
          const p = this.groundPoint(click.ndcX, click.ndcY, camera);
          if (p) {
            if (this.commands.mode === 'attack-move') this.commands.order('attack-move', p.x, p.z);
            else this.commands.order('attack-ground', p.x, p.z);
          }
          continue;
        }
        const picked = this.pickUnit(click.x, click.y, camera, viewportW, viewportH, 'player');
        if (picked !== null) {
          this.commands.select([picked], click.shift);
        } else if (!click.shift) {
          this.commands.select([], false);
        }
      } else if (click.button === 2) {
        // context order: attack spotted enemy under cursor, else move
        const enemy = this.pickUnit(click.x, click.y, camera, viewportW, viewportH, 'enemy');
        if (enemy !== null) {
          const target = this.gs.byId.get(enemy);
          if (target) this.commands.order('attack-target', target.x, target.z, enemy);
          continue;
        }
        const p = this.groundPoint(click.ndcX, click.ndcY, camera);
        if (p) this.commands.order('move', p.x, p.z);
      }
    }
  }

  /** Hotkeys routed from App after global keys are handled. Returns true when consumed. */
  handleKey(key: string, ctrl: boolean): boolean {
    switch (key) {
      case 'A':
        this.commands.mode = 'attack-move';
        return true;
      case 'G':
        this.commands.mode = 'attack-ground';
        return true;
      case 'S':
        this.commands.stop();
        return true;
      case 'H':
        this.commands.hold();
        return true;
      default: {
        const n = Number(key);
        if (Number.isInteger(n) && n >= 1 && n <= 9) {
          if (ctrl) this.commands.assignGroup(n);
          else return this.commands.recallGroup(n);
          return true;
        }
        return false;
      }
    }
  }

  /** Intersect a camera ray with the terrain heightfield (march + bisect). */
  groundPoint(ndcX: number, ndcY: number, camera: PerspectiveCamera): { x: number; z: number } | null {
    this.origin.setFromMatrixPosition(camera.matrixWorld);
    this.dir.set(ndcX, ndcY, 0.5).unproject(camera).sub(this.origin).normalize();
    let prevT = 0;
    let prevD = this.origin.y - this.ground.height(this.origin.x, this.origin.z);
    for (let t = 4; t < 1600; t += 4) {
      const x = this.origin.x + this.dir.x * t;
      const y = this.origin.y + this.dir.y * t;
      const z = this.origin.z + this.dir.z * t;
      const d = y - this.ground.height(x, z);
      if (d <= 0) {
        // bisect between prevT and t
        let lo = prevT;
        let hi = t;
        for (let i = 0; i < 12; i++) {
          const mid = (lo + hi) / 2;
          const mx = this.origin.x + this.dir.x * mid;
          const my = this.origin.y + this.dir.y * mid;
          const mz = this.origin.z + this.dir.z * mid;
          if (my - this.ground.height(mx, mz) > 0) lo = mid;
          else hi = mid;
        }
        const ft = (lo + hi) / 2;
        return { x: this.origin.x + this.dir.x * ft, z: this.origin.z + this.dir.z * ft };
      }
      prevT = t;
      prevD = d;
    }
    void prevD;
    return null;
  }

  private pickUnit(
    px: number,
    py: number,
    camera: PerspectiveCamera,
    viewportW: number,
    viewportH: number,
    side: 'player' | 'enemy',
  ): number | null {
    let best: number | null = null;
    let bestD = PICK_RADIUS_PX;
    for (const u of this.gs.units) {
      if (!u.alive || u.side !== side) continue;
      if (side === 'enemy' && !u.spotted) continue;
      this.v.set(u.x, u.y + 1.2, u.z).project(camera);
      if (this.v.z > 1) continue;
      const sx = (this.v.x * 0.5 + 0.5) * viewportW;
      const sy = (-this.v.y * 0.5 + 0.5) * viewportH;
      const d = Math.hypot(sx - px, sy - py);
      if (d < bestD) {
        bestD = d;
        best = u.id;
      }
    }
    return best;
  }

  private rectSelect(click: ClickEvent, camera: PerspectiveCamera, viewportW: number, viewportH: number): void {
    const x0 = Math.min(click.dragStartX, click.x);
    const y0 = Math.min(click.dragStartY, click.y);
    const x1 = Math.max(click.dragStartX, click.x);
    const y1 = Math.max(click.dragStartY, click.y);
    const ids: number[] = [];
    for (const u of this.gs.units) {
      if (!u.alive || u.side !== 'player') continue;
      this.v.set(u.x, u.y + 1, u.z).project(camera);
      if (this.v.z > 1) continue;
      const sx = (this.v.x * 0.5 + 0.5) * viewportW;
      const sy = (-this.v.y * 0.5 + 0.5) * viewportH;
      if (sx >= x0 && sx <= x1 && sy >= y0 && sy <= y1) ids.push(u.id);
    }
    if (ids.length > 0) this.commands.select(ids, click.shift);
    else if (!click.shift) this.commands.select([], false);
  }

  /** Auto-targeting glue used by ARCHETYPES-aware callers. */
  archOf(id: number): (typeof ARCHETYPES)[keyof typeof ARCHETYPES] | null {
    const u = this.gs.byId.get(id);
    return u ? ARCHETYPES[u.cls] : null;
  }
}
