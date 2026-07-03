/**
 * Live minimap: static painted terrain map composited with real unit
 * positions (player green, SPOTTED enemies red — hidden enemies are not
 * drawn), objective ring, wrecks, and the camera view trapezoid.
 * Left-click focuses the camera; right-click issues a move order.
 */

import type { MinimapMaps } from '../world/MinimapData.ts';
import type { GameState } from '../game/GameState.ts';
import { ARCHETYPES } from '../game/Types.ts';
import type { PerspectiveCamera } from 'three';
import { Vector3 } from 'three';

export interface MinimapCallbacks {
  onFocus: (x: number, z: number) => void;
  onMoveOrder: (x: number, z: number) => void;
}

export class Minimap {
  readonly container: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private sizePx: number;
  private circular: boolean;
  private lastDraw = 0;

  constructor(
    parent: HTMLElement,
    private maps: MinimapMaps,
    private cb: MinimapCallbacks,
    opts: { sizePx: number; circular: boolean; id: string },
  ) {
    this.sizePx = opts.sizePx;
    this.circular = opts.circular;
    this.container = document.createElement('div');
    this.container.id = opts.id;
    this.container.className = 'minimap-box' + (opts.circular ? ' circular' : '');
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.sizePx;
    this.canvas.height = this.sizePx;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('minimap 2d context unavailable');
    this.ctx = ctx;
    this.container.append(this.canvas);
    parent.append(this.container);

    this.canvas.addEventListener('mousedown', (e) => {
      const world = this.toWorld(e);
      if (!world) return;
      if (e.button === 2) this.cb.onMoveOrder(world.x, world.z);
      else this.cb.onFocus(world.x, world.z);
    });
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  destroy(): void {
    this.container.remove();
  }

  private toWorld(e: MouseEvent): { x: number; z: number } | null {
    const rect = this.canvas.getBoundingClientRect();
    const u = (e.clientX - rect.left) / rect.width;
    const v = (e.clientY - rect.top) / rect.height;
    if (u < 0 || v < 0 || u > 1 || v > 1) return null;
    return { x: (u * 2 - 1) * this.maps.worldHalf, z: (v * 2 - 1) * this.maps.worldHalf };
  }

  private toPx(x: number, z: number): { px: number; py: number } {
    return {
      px: ((x / this.maps.worldHalf) * 0.5 + 0.5) * this.sizePx,
      py: ((z / this.maps.worldHalf) * 0.5 + 0.5) * this.sizePx,
    };
  }

  update(nowMs: number, gs: GameState, camera: PerspectiveCamera, centerOn?: { x: number; z: number }): void {
    if (nowMs - this.lastDraw < 100) return;
    this.lastDraw = nowMs;
    const ctx = this.ctx;
    const S = this.sizePx;
    ctx.clearRect(0, 0, S, S);

    ctx.save();
    if (this.circular) {
      ctx.beginPath();
      ctx.arc(S / 2, S / 2, S / 2 - 1, 0, Math.PI * 2);
      ctx.clip();
    }

    // static map, optionally zoomed around a center (tank mode)
    if (centerOn) {
      const zoom = 3.2;
      const c = this.toPx(centerOn.x, centerOn.z);
      ctx.drawImage(
        this.maps.canvas,
        (c.px / S) * this.maps.sizePx - this.maps.sizePx / (2 * zoom),
        (c.py / S) * this.maps.sizePx - this.maps.sizePx / (2 * zoom),
        this.maps.sizePx / zoom,
        this.maps.sizePx / zoom,
        0,
        0,
        S,
        S,
      );
      ctx.restore();
      ctx.save();
      if (this.circular) {
        ctx.beginPath();
        ctx.arc(S / 2, S / 2, S / 2 - 1, 0, Math.PI * 2);
        ctx.clip();
      }
      this.drawDynamic(ctx, gs, camera, centerOn, zoom);
    } else {
      ctx.drawImage(this.maps.canvas, 0, 0, S, S);
      this.drawDynamic(ctx, gs, camera, null, 1);
    }
    ctx.restore();
  }

  private project(x: number, z: number, centerOn: { x: number; z: number } | null, zoom: number): { px: number; py: number } {
    const S = this.sizePx;
    if (!centerOn) return this.toPx(x, z);
    const c = this.toPx(centerOn.x, centerOn.z);
    const p = this.toPx(x, z);
    return { px: (p.px - c.px) * zoom + S / 2, py: (p.py - c.py) * zoom + S / 2 };
  }

  private drawDynamic(
    ctx: CanvasRenderingContext2D,
    gs: GameState,
    camera: PerspectiveCamera,
    centerOn: { x: number; z: number } | null,
    zoom: number,
  ): void {
    // objective ring
    const zonePx = this.project(gs.model.captureZone.x, gs.model.captureZone.z, centerOn, zoom);
    const rPx = (gs.model.captureZone.radius / this.maps.worldHalf) * 0.5 * this.sizePx * zoom;
    ctx.beginPath();
    ctx.arc(zonePx.px, zonePx.py, rPx, 0, Math.PI * 2);
    const contested = gs.captureStateLabel === 'Contested' || gs.captureStateLabel === 'Enemy Recapturing';
    ctx.strokeStyle = contested ? 'rgba(216,110,70,0.95)' : 'rgba(226,220,196,0.9)';
    ctx.lineWidth = 1.6;
    ctx.setLineDash([4, 3]);
    ctx.stroke();
    ctx.setLineDash([]);
    // star
    ctx.fillStyle = gs.captureProgress >= 1 ? '#b7c47a' : '#e2dcc4';
    ctx.font = `${Math.max(9, rPx * 0.8)}px serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('★', zonePx.px, zonePx.py);

    // wrecks
    ctx.strokeStyle = 'rgba(30,26,22,0.9)';
    ctx.lineWidth = 1.4;
    for (const u of gs.units) {
      if (!u.isWreck) continue;
      const p = this.project(u.x, u.z, centerOn, zoom);
      ctx.beginPath();
      ctx.moveTo(p.px - 3, p.py - 3);
      ctx.lineTo(p.px + 3, p.py + 3);
      ctx.moveTo(p.px + 3, p.py - 3);
      ctx.lineTo(p.px - 3, p.py + 3);
      ctx.stroke();
    }

    // units — player always, enemies ONLY when spotted (fog of war)
    for (const u of gs.units) {
      if (!u.alive) continue;
      const p = this.project(u.x, u.z, centerOn, zoom);
      if (p.px < -8 || p.py < -8 || p.px > this.sizePx + 8 || p.py > this.sizePx + 8) continue;
      if (u.side === 'player') {
        const vehicle = ARCHETYPES[u.cls].kind === 'vehicle';
        ctx.fillStyle = u.cls === 'scout-team' ? '#8fd0e8' : '#8fd06a';
        if (vehicle) {
          ctx.save();
          ctx.translate(p.px, p.py);
          ctx.rotate(u.yaw + Math.PI / 2);
          ctx.fillRect(-3, -4, 6, 8);
          ctx.restore();
        } else {
          ctx.beginPath();
          ctx.arc(p.px, p.py, 2.6, 0, Math.PI * 2);
          ctx.fill();
        }
      } else if (u.spotted) {
        ctx.fillStyle = '#e05840';
        ctx.save();
        ctx.translate(p.px, p.py);
        ctx.rotate(Math.PI / 4);
        ctx.fillRect(-2.8, -2.8, 5.6, 5.6);
        ctx.restore();
      }
    }

    // camera view: project frustum corners to the ground plane
    ctx.strokeStyle = 'rgba(240,236,214,0.75)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    const corners: [number, number][] = [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ];
    let started = false;
    for (const [nx, ny] of corners) {
      const hit = groundIntersect(camera, nx, ny);
      if (!hit) continue;
      const p = this.project(hit.x, hit.z, centerOn, zoom);
      const px = Math.max(-40, Math.min(this.sizePx + 40, p.px));
      const py = Math.max(-40, Math.min(this.sizePx + 40, p.py));
      if (!started) {
        ctx.moveTo(px, py);
        started = true;
      } else ctx.lineTo(px, py);
    }
    if (started) {
      ctx.closePath();
      ctx.stroke();
    }
  }
}

const _origin = new Vector3();
const _dir = new Vector3();

/** Intersect a camera NDC ray with the y=0 ground plane. */
function groundIntersect(camera: PerspectiveCamera, ndcX: number, ndcY: number): { x: number; z: number } | null {
  _origin.setFromMatrixPosition(camera.matrixWorld);
  _dir.set(ndcX, ndcY, 0.5).unproject(camera).sub(_origin).normalize();
  if (Math.abs(_dir.y) < 1e-4) return null;
  const t = -_origin.y / _dir.y;
  if (t < 0 || t > 3000) return null;
  return { x: _origin.x + _dir.x * t, z: _origin.z + _dir.z * t };
}
