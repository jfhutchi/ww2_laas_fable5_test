/**
 * Tactical command HUD: objective panel, capture status, unit roster,
 * selected-unit detail, command buttons, and time controls. Every value is
 * bound from the live GameState — nothing is synthesized.
 */

import type { GameState } from '../game/GameState.ts';
import type { Commands } from '../game/Commands.ts';
import { ARCHETYPES, type UnitState } from '../game/Types.ts';

export interface TacticalHudCallbacks {
  onSpeed: (mult: number) => void;
  onMenu: () => void;
  onFocusUnit: (u: UnitState) => void;
  onCommandMode: (mode: 'attack-move' | 'attack-ground') => void;
  onStop: () => void;
  onHold: () => void;
  onDirectControl: () => void;
}

const GLYPH: Record<string, string> = {
  sherman: '▣',
  stug: '▣',
  panzer4: '▣',
  'rifle-squad': '⠿',
  'scout-team': '⠓',
  'grenadier-squad': '⠿',
  'at-gun': '⊥',
  'mg-team': '≡',
};

export class TacticalHud {
  private root: HTMLDivElement;
  private objectiveList!: HTMLDivElement;
  private timeLabel!: HTMLDivElement;
  private captureState!: HTMLDivElement;
  private captureFill!: HTMLDivElement;
  private captureContest!: HTMLDivElement;
  private rosterRows = new Map<number, { row: HTMLDivElement; fill: HTMLDivElement; label: HTMLDivElement }>();
  private rosterBox!: HTMLDivElement;
  private selectedBox!: HTMLDivElement;
  private speedButtons = new Map<number, HTMLButtonElement>();
  private lastDomUpdate = 0;

  private leftColumn: HTMLDivElement;

  constructor(
    parent: HTMLElement,
    private gs: GameState,
    private commands: Commands,
    private cb: TacticalHudCallbacks,
  ) {
    this.root = document.createElement('div');
    this.root.id = 'tactical-hud';
    parent.append(this.root);
    // objective + roster stack in a flex column so they can never overlap
    this.leftColumn = document.createElement('div');
    this.leftColumn.id = 'left-column';
    this.root.append(this.leftColumn);
    this.buildObjectivePanel();
    this.buildTimeControls();
    this.buildCapturePanel();
    this.buildRoster();
    this.buildSelectedPanel();
    this.buildCommandPanel();
  }

  destroy(): void {
    this.root.remove();
  }

  setVisible(v: boolean): void {
    this.root.style.display = v ? 'block' : 'none';
  }

  // ------------------------------------------------------------- builders

  private panel(id: string, title?: string, inLeftColumn = false): HTMLDivElement {
    const p = document.createElement('div');
    p.className = 'oc-panel';
    p.id = id;
    if (title) {
      const t = document.createElement('div');
      t.className = 'oc-panel-title';
      t.textContent = title;
      p.append(t);
    }
    (inLeftColumn ? this.leftColumn : this.root).append(p);
    return p;
  }

  private buildObjectivePanel(): void {
    const p = this.panel('objective-panel', 'Objective', true);
    const name = document.createElement('div');
    name.id = 'objective-name';
    name.textContent = 'Capture the Crossroads';
    this.objectiveList = document.createElement('div');
    this.objectiveList.id = 'objective-list';
    this.timeLabel = document.createElement('div');
    this.timeLabel.id = 'objective-time';
    p.append(name, this.objectiveList, this.timeLabel);
  }

  private buildTimeControls(): void {
    const p = this.panel('time-controls');
    const speeds: [string, number][] = [
      ['PAUSE', 0],
      ['SLOW', 0.5],
      ['NORMAL', 1],
      ['FAST', 2],
    ];
    for (const [label, mult] of speeds) {
      const b = document.createElement('button');
      b.className = 'time-btn';
      b.textContent = label;
      b.addEventListener('click', () => {
        this.gs.bus.emit('ui:click', {});
        this.cb.onSpeed(mult);
      });
      this.speedButtons.set(mult, b);
      p.append(b);
    }
    const menu = document.createElement('button');
    menu.className = 'time-btn menu';
    menu.textContent = 'MENU';
    menu.addEventListener('click', () => this.cb.onMenu());
    p.append(menu);
  }

  private buildCapturePanel(): void {
    const p = this.panel('capture-panel');
    const head = document.createElement('div');
    head.id = 'capture-head';
    const star = document.createElement('div');
    star.id = 'capture-star';
    star.textContent = '✪';
    const col = document.createElement('div');
    const title = document.createElement('div');
    title.id = 'capture-title';
    title.textContent = 'VILLAGE CENTER';
    this.captureState = document.createElement('div');
    this.captureState.id = 'capture-state';
    this.captureState.textContent = 'Neutral';
    col.append(title, this.captureState);
    head.append(star, col);
    const track = document.createElement('div');
    track.id = 'capture-track';
    this.captureFill = document.createElement('div');
    this.captureFill.id = 'capture-fill';
    this.captureContest = document.createElement('div');
    this.captureContest.id = 'capture-contest';
    track.append(this.captureFill, this.captureContest);
    p.append(head, track);
  }

  private buildRoster(): void {
    this.rosterBox = this.panel('unit-roster', undefined, true);
    for (const u of this.gs.units) {
      if (u.side !== 'player') continue;
      const row = document.createElement('div');
      row.className = 'roster-row';
      const num = document.createElement('div');
      num.className = 'roster-num';
      num.textContent = u.callsign;
      const glyph = document.createElement('div');
      glyph.className = 'roster-glyph';
      glyph.textContent = GLYPH[u.cls] ?? '?';
      const mid = document.createElement('div');
      mid.className = 'roster-mid';
      const label = document.createElement('div');
      label.className = 'roster-label';
      label.textContent = ARCHETYPES[u.cls].label.toUpperCase();
      const track = document.createElement('div');
      track.className = 'bar-track';
      const fill = document.createElement('div');
      fill.className = 'bar-fill';
      fill.style.width = '100%';
      track.append(fill);
      mid.append(label, track);
      row.append(num, glyph, mid);
      row.addEventListener('click', (e) => {
        this.commands.select([u.id], e.shiftKey);
      });
      row.addEventListener('dblclick', () => this.cb.onFocusUnit(u));
      this.rosterBox.append(row);
      this.rosterRows.set(u.id, { row, fill, label });
    }
  }

  private buildSelectedPanel(): void {
    this.selectedBox = this.panel('selected-panel', 'Selection');
  }

  private buildCommandPanel(): void {
    const p = this.panel('command-panel');
    const cmds: [string, string, () => void][] = [
      ['ATTACK MOVE', 'A', () => this.cb.onCommandMode('attack-move')],
      ['ATTACK GROUND', 'G', () => this.cb.onCommandMode('attack-ground')],
      ['STOP', 'S', () => this.cb.onStop()],
      ['HOLD', 'H', () => this.cb.onHold()],
      ['TAKE CONTROL', 'TAB', () => this.cb.onDirectControl()],
    ];
    for (const [label, key, fn] of cmds) {
      const b = document.createElement('button');
      b.className = 'cmd-btn';
      const k = document.createElement('span');
      k.className = 'cmd-key';
      k.textContent = key;
      const l = document.createElement('span');
      l.textContent = label;
      b.append(l, k);
      b.addEventListener('click', () => {
        this.gs.bus.emit('ui:click', {});
        fn();
      });
      p.append(b);
    }
  }

  // --------------------------------------------------------------- update

  update(nowMs: number, speed: number, capture: { state: string; progress: number }): void {
    if (nowMs - this.lastDomUpdate < 120) return;
    this.lastDomUpdate = nowMs;

    // objective checklist
    const objectives: [string, boolean][] = [
      ['Advance into the village', this.gs.units.some((u) => u.side === 'player' && u.alive && Math.hypot(u.x, u.z) < 260)],
      ['Neutralize the defenders', this.gs.units.filter((u) => u.side === 'enemy' && u.alive && u.aiRole !== 'reinforcement').length <= 2],
      ['Capture the crossroads', capture.progress >= 1],
      ['Hold the village center', this.gs.missionState === 'won'],
    ];
    this.objectiveList.replaceChildren(
      ...objectives.map(([text, done]) => {
        const row = document.createElement('div');
        row.className = 'objective-row' + (done ? ' done' : '');
        row.textContent = `${done ? '☑' : '☐'} ${text}`;
        return row;
      }),
    );
    const t = this.gs.missionTime;
    const mm = Math.floor(t / 60).toString().padStart(2, '0');
    const ss = Math.floor(t % 60).toString().padStart(2, '0');
    this.timeLabel.textContent = `T+${mm}:${ss}`;

    // capture
    this.captureState.textContent = capture.state;
    this.captureState.className = '';
    this.captureState.id = 'capture-state';
    if (capture.state === 'Contested') this.captureState.classList.add('contested');
    else if (capture.state === 'Secured' || capture.state === 'Securing') this.captureState.classList.add('securing');
    else if (capture.state === 'Enemy Recapturing') this.captureState.classList.add('enemy');
    this.captureFill.style.width = `${(capture.progress * 100).toFixed(1)}%`;
    this.captureContest.style.display = capture.state === 'Contested' ? 'block' : 'none';

    // roster
    for (const [id, els] of this.rosterRows) {
      const u = this.gs.byId.get(id);
      if (!u) continue;
      const hpFrac = Math.max(0, u.hp) / ARCHETYPES[u.cls].maxHp;
      els.fill.style.width = `${(hpFrac * 100).toFixed(0)}%`;
      els.fill.className = 'bar-fill' + (hpFrac < 0.3 ? ' critical' : hpFrac < 0.6 ? ' low' : '');
      els.row.classList.toggle('dead', !u.alive);
      els.row.classList.toggle('selected', this.commands.selection.has(id));
      els.row.classList.toggle('suppressed', u.pinned);
    }

    // selection detail
    const sel = this.commands.selectedUnits();
    if (sel.length === 0) {
      this.selectedBox.style.display = 'none';
    } else {
      this.selectedBox.style.display = 'block';
      const rows: HTMLElement[] = [];
      const title = document.createElement('div');
      title.className = 'oc-panel-title';
      title.textContent = sel.length === 1 ? 'Selected Unit' : `Selection — ${sel.length} units`;
      rows.push(title);
      for (const u of sel.slice(0, 4)) {
        const arch = ARCHETYPES[u.cls];
        const row = document.createElement('div');
        row.className = 'sel-row';
        const name = document.createElement('div');
        name.className = 'sel-name';
        name.textContent = `${u.callsign} · ${arch.label}`;
        const stats = document.createElement('div');
        stats.className = 'sel-stats';
        const w0 = u.weapons[0];
        const reload = w0 && w0.reloadLeft > 0 ? ` · reloading ${w0.reloadLeft.toFixed(1)}s` : ' · ready';
        const supp = u.suppression > 0.3 ? (u.pinned ? ' · PINNED' : ' · suppressed') : '';
        const men = arch.soldiers > 0 ? ` · ${u.soldiers.filter((s) => s.alive).length}/${arch.soldiers} men` : '';
        stats.textContent = `HP ${Math.max(0, Math.round(u.hp))}/${arch.maxHp}${men}${arch.kind === 'vehicle' ? reload : ''}${supp}`;
        const track = document.createElement('div');
        track.className = 'bar-track';
        const fill = document.createElement('div');
        const frac = Math.max(0, u.hp) / arch.maxHp;
        fill.className = 'bar-fill' + (frac < 0.3 ? ' critical' : frac < 0.6 ? ' low' : '');
        fill.style.width = `${frac * 100}%`;
        track.append(fill);
        row.append(name, stats, track);
        rows.push(row);
      }
      if (sel.length > 4) {
        const more = document.createElement('div');
        more.className = 'sel-more';
        more.textContent = `+${sel.length - 4} more`;
        rows.push(more);
      }
      this.selectedBox.replaceChildren(...rows);
    }

    // speed button highlight
    for (const [mult, btn] of this.speedButtons) {
      btn.classList.toggle('active', Math.abs(speed - mult) < 0.01);
    }
  }
}
