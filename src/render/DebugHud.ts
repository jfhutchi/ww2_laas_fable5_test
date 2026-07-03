/**
 * F3 performance/debug HUD. Every number shown is read from the live
 * renderer/simulation — nothing here is synthesized.
 */

import type { OcStats } from '../app/Hooks.ts';

export class DebugHud {
  private el: HTMLDivElement;
  private visible = false;
  private lastUpdate = 0;

  constructor(parent: HTMLElement, startVisible: boolean) {
    this.el = document.createElement('div');
    this.el.id = 'debug-hud';
    parent.append(this.el);
    this.setVisible(startVisible);
  }

  toggle(): void {
    this.setVisible(!this.visible);
  }

  setVisible(v: boolean): void {
    this.visible = v;
    this.el.style.display = v ? 'block' : 'none';
  }

  get isVisible(): boolean {
    return this.visible;
  }

  update(nowMs: number, stats: OcStats, extra: Record<string, string | number>): void {
    if (!this.visible || nowMs - this.lastUpdate < 250) return;
    this.lastUpdate = nowMs;
    const r = stats.render;
    const g = stats.game;
    const lines: string[] = [
      `fps ${r.fps.toFixed(0)}  frame ${r.frameMs.toFixed(1)}ms  #${r.frame}`,
      `draws ${r.drawCalls}  tris ${fmt(r.triangles)}  pts ${fmt(r.points)}`,
      `geom ${r.geometries}  tex ${r.textures}`,
      `seed ${stats.seed}  preset ${stats.preset}`,
    ];
    if (g) {
      lines.push(
        `mode ${g.mode}  tick ${g.simTick}  t ${g.simTime.toFixed(1)}s`,
        `units P${g.playerAlive}/${g.playerUnits} E${g.enemyAlive}/${g.enemyUnits}  spotted ${g.spottedEnemies}`,
        `proj live ${g.projectilesLive}  fired ${g.projectilesFired}  hits ${g.projectileHits}`,
        `destroyed ${g.unitsDestroyed}  wrecks ${g.wrecks}`,
        `capture ${g.captureState} ${(g.captureProgress * 100).toFixed(0)}%  mission ${g.missionState}`,
      );
    }
    for (const [k, v] of Object.entries(extra)) lines.push(`${k} ${v}`);
    if (stats.errors.length > 0) lines.push(`ERRORS ${stats.errors.length}`);
    this.el.textContent = lines.join('\n');
  }
}

function fmt(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return String(n);
}
