/**
 * Main menu / pause menu / mission-end screen. All buttons drive real game
 * flow through the callbacks provided by App.
 */

import type { Difficulty, GraphicsPreset } from '../app/Config.ts';

export interface MenuCallbacks {
  onStart: (opts: { seed: number; difficulty: Difficulty; preset: GraphicsPreset }) => void;
  onResume: () => void;
  onRestart: (opts: { seed: number; difficulty: Difficulty; preset: GraphicsPreset }) => void;
  onQuitToMenu: () => void;
}

type MenuState = 'main' | 'paused' | 'won' | 'lost' | 'hidden';

export class Menu {
  private overlay: HTMLDivElement;
  private card: HTMLDivElement;
  private state: MenuState = 'hidden';
  private cb: MenuCallbacks;
  private seed: number;
  private difficulty: Difficulty;
  private preset: GraphicsPreset;
  private helpVisible = false;

  constructor(parent: HTMLElement, cb: MenuCallbacks, seed: number, difficulty: Difficulty, preset: GraphicsPreset) {
    this.cb = cb;
    this.seed = seed;
    this.difficulty = difficulty;
    this.preset = preset;
    this.overlay = document.createElement('div');
    this.overlay.id = 'menu-overlay';
    this.card = document.createElement('div');
    this.card.id = 'menu-card';
    this.overlay.append(this.card);
    parent.append(this.overlay);
    this.hide();
  }

  get visible(): boolean {
    return this.state !== 'hidden';
  }

  get currentState(): MenuState {
    return this.state;
  }

  showMain(): void {
    this.state = 'main';
    this.render();
  }

  showPaused(): void {
    this.state = 'paused';
    this.render();
  }

  showEnd(won: boolean, detail: string): void {
    this.state = won ? 'won' : 'lost';
    this.endDetail = detail;
    this.render();
  }

  hide(): void {
    this.state = 'hidden';
    this.overlay.style.display = 'none';
  }

  private endDetail = '';

  private options(): { seed: number; difficulty: Difficulty; preset: GraphicsPreset } {
    return { seed: this.seed, difficulty: this.difficulty, preset: this.preset };
  }

  private render(): void {
    this.overlay.style.display = 'flex';
    this.card.replaceChildren();

    if (this.state === 'won' || this.state === 'lost') {
      const t = document.createElement('div');
      t.id = 'menu-end-title';
      t.classList.add(this.state);
      t.textContent = this.state === 'won' ? 'MISSION ACCOMPLISHED' : 'MISSION FAILED';
      const d = document.createElement('div');
      d.id = 'menu-end-detail';
      d.textContent = this.endDetail;
      this.card.append(t, d);
    } else {
      const t = document.createElement('div');
      t.id = 'menu-title';
      t.textContent = 'OPERATION CROSSROADS';
      const s = document.createElement('div');
      s.id = 'menu-sub';
      s.textContent = this.state === 'paused' ? 'Paused — Normandy, June 1944' : 'Normandy · June 1944';
      this.card.append(t, s);
    }

    if (this.state === 'main' || this.state === 'won' || this.state === 'lost') {
      const row = document.createElement('div');
      row.className = 'menu-row';
      row.append(
        this.selectField('Difficulty', ['easy', 'normal', 'hard'], this.difficulty, (v) => {
          this.difficulty = v as Difficulty;
        }),
        this.selectField('Graphics', ['low', 'high', 'ultra'], this.preset, (v) => {
          this.preset = v as GraphicsPreset;
        }),
        this.seedField(),
      );
      this.card.append(row);
    }

    const isRestart = this.state === 'won' || this.state === 'lost';
    if (this.state === 'paused') {
      this.card.append(
        this.button('Resume', () => this.cb.onResume()),
        this.button('Restart Mission', () => this.cb.onRestart(this.options()), true),
        this.button('Quit to Menu', () => this.cb.onQuitToMenu(), true),
      );
    } else {
      this.card.append(
        this.button(isRestart ? 'Restart Mission' : 'Start Mission', () => {
          (isRestart ? this.cb.onRestart : this.cb.onStart)(this.options());
        }),
      );
      if (isRestart) this.card.append(this.button('Back to Menu', () => this.cb.onQuitToMenu(), true));
    }

    this.card.append(this.button('Controls / Help', () => this.toggleHelp(), true));
    this.card.append(this.helpPanel());
  }

  private selectField(label: string, values: string[], current: string, onChange: (v: string) => void): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'menu-field';
    const l = document.createElement('label');
    l.textContent = label;
    const sel = document.createElement('select');
    for (const v of values) {
      const o = document.createElement('option');
      o.value = v;
      o.textContent = v.charAt(0).toUpperCase() + v.slice(1);
      if (v === current) o.selected = true;
      sel.append(o);
    }
    sel.addEventListener('change', () => onChange(sel.value));
    wrap.append(l, sel);
    return wrap;
  }

  private seedField(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'menu-field';
    const l = document.createElement('label');
    l.textContent = 'Seed';
    const input = document.createElement('input');
    input.type = 'number';
    input.value = String(this.seed);
    input.addEventListener('change', () => {
      const v = Number(input.value);
      if (Number.isFinite(v)) this.seed = Math.floor(v);
    });
    wrap.append(l, input);
    return wrap;
  }

  private button(label: string, onClick: () => void, secondary = false): HTMLButtonElement {
    const b = document.createElement('button');
    b.className = secondary ? 'menu-btn secondary' : 'menu-btn';
    b.textContent = label;
    b.addEventListener('click', onClick);
    return b;
  }

  private toggleHelp(): void {
    this.helpVisible = !this.helpVisible;
    const el = this.card.querySelector<HTMLDivElement>('#menu-help');
    if (el) el.style.display = this.helpVisible ? 'block' : 'none';
  }

  private helpPanel(): HTMLDivElement {
    const help = document.createElement('div');
    help.id = 'menu-help';
    help.style.display = this.helpVisible ? 'block' : 'none';
    const rows = (pairs: [string, string][]): string =>
      pairs.map(([k, v]) => `<tr><td class="k">${k}</td><td>${v}</td></tr>`).join('');
    // Static trusted markup only (no user input).
    help.innerHTML =
      `<h3>Global</h3><table>${rows([
        ['Tab', 'Switch tactical / direct tank control'],
        ['Esc', 'Menu / pause'],
        ['Space', 'Pause / unpause (tactical)'],
        ['F3', 'Debug HUD'],
        ['P', 'Print camera pose + seed to console'],
        ['1–9', 'Control groups (Ctrl+n assign) / camera bookmarks'],
      ])}</table>` +
      `<h3>Tactical mode</h3><table>${rows([
        ['Left click', 'Select unit'],
        ['Shift+click', 'Add / remove from selection'],
        ['Left drag', 'Selection rectangle'],
        ['Right click', 'Move — on enemy: attack'],
        ['A', 'Attack-move to point'],
        ['G', 'Attack ground'],
        ['S', 'Stop'],
        ['H', 'Hold position'],
        ['WASD / edge', 'Pan camera'],
        ['Q / E', 'Rotate camera'],
        ['Wheel', 'Zoom'],
        ['Middle drag', 'Rotate / tilt camera'],
      ])}</table>` +
      `<h3>Tank mode</h3><table>${rows([
        ['W / S', 'Throttle forward / reverse'],
        ['A / D', 'Steer tracks'],
        ['Mouse', 'Aim turret'],
        ['Left click', 'Fire main gun'],
        ['Right click', 'Fire machine gun'],
        ['R', 'Reload'],
        ['Shift', 'Overdrive'],
        ['C', 'Camera shoulder / distance'],
        ['Tab', 'Return to command'],
      ])}</table>`;
    return help;
  }
}
