/**
 * Screen-space unit markers: tactical icons + health bars floating above
 * units (player always; enemies only while spotted). DOM-based so they stay
 * crisp at any resolution; clicking a marker selects the unit.
 */

import type { PerspectiveCamera } from 'three';
import { Vector3 } from 'three';
import type { GameState } from '../game/GameState.ts';
import { ARCHETYPES, type UnitState } from '../game/Types.ts';
import { boundedMeterFraction } from './MeterMath.ts';

const GLYPHS: Record<string, string> = {
  sherman: '▮',
  stug: '▮',
  panzer4: '▮',
  'rifle-squad': '⁙',
  'scout-team': '◉',
  'grenadier-squad': '⁙',
  'at-gun': '⟂',
  'mg-team': '☰',
};

interface MarkerEls {
  root: HTMLDivElement;
  glyph: HTMLDivElement;
  bar: HTMLDivElement;
  suppress: HTMLDivElement;
}

export class UnitMarkers {
  private container: HTMLDivElement;
  private markers = new Map<number, MarkerEls>();
  private v = new Vector3();

  constructor(
    parent: HTMLElement,
    private gs: GameState,
    private onSelect: (id: number, additive: boolean) => void,
  ) {
    this.container = document.createElement('div');
    this.container.id = 'unit-markers';
    parent.append(this.container);
  }

  destroy(): void {
    this.container.remove();
  }

  setVisible(v: boolean): void {
    this.container.style.display = v ? 'block' : 'none';
  }

  private ensure(u: UnitState): MarkerEls {
    let m = this.markers.get(u.id);
    if (m) return m;
    const root = document.createElement('div');
    root.className = `unit-marker ${u.side}`;
    const glyph = document.createElement('div');
    glyph.className = 'marker-glyph';
    glyph.textContent = GLYPHS[u.cls] ?? '?';
    const barTrack = document.createElement('div');
    barTrack.className = 'marker-bar';
    const bar = document.createElement('div');
    bar.className = 'marker-fill';
    barTrack.append(bar);
    const suppress = document.createElement('div');
    suppress.className = 'marker-suppress';
    suppress.textContent = '⚠';
    root.append(glyph, barTrack, suppress);
    root.addEventListener('mousedown', (e) => {
      if (u.side !== 'player') return;
      e.stopPropagation();
      this.onSelect(u.id, e.shiftKey);
    });
    this.container.append(root);
    m = { root, glyph, bar, suppress };
    this.markers.set(u.id, m);
    return m;
  }

  update(camera: PerspectiveCamera, viewportW: number, viewportH: number, selection: ReadonlySet<number>): void {
    for (const u of this.gs.units) {
      const m = this.ensure(u);
      const visible = u.alive && (u.side === 'player' || u.spotted);
      if (!visible) {
        m.root.style.display = 'none';
        continue;
      }
      const arch = ARCHETYPES[u.cls];
      const height = arch.kind === 'vehicle' ? 3.6 : 2.5;
      this.v.set(u.x, u.y + height, u.z).project(camera);
      if (this.v.z > 1 || this.v.x < -1.1 || this.v.x > 1.1 || this.v.y < -1.1 || this.v.y > 1.1) {
        m.root.style.display = 'none';
        continue;
      }
      const sx = (this.v.x * 0.5 + 0.5) * viewportW;
      const sy = (-this.v.y * 0.5 + 0.5) * viewportH;
      m.root.style.display = 'block';
      m.root.style.transform = `translate(${sx.toFixed(1)}px, ${sy.toFixed(1)}px) translate(-50%, -100%)`;
      const frac = boundedMeterFraction(u.hp, arch.maxHp);
      m.bar.style.width = `${(frac * 100).toFixed(0)}%`;
      m.bar.className = 'marker-fill' + (frac < 0.3 ? ' critical' : frac < 0.6 ? ' low' : '');
      m.root.classList.toggle('selected', selection.has(u.id));
      m.suppress.style.display = u.pinned ? 'block' : 'none';
    }
  }
}
