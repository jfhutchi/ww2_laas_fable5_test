/** Main, pause, and mission-end field dossier. */

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
  private helpVisible = false;
  private endDetail = '';

  constructor(
    parent: HTMLElement,
    private cb: MenuCallbacks,
    private seed: number,
    private difficulty: Difficulty,
    private preset: GraphicsPreset,
  ) {
    this.overlay = document.createElement('div');
    this.overlay.id = 'menu-overlay';
    this.overlay.setAttribute('role', 'dialog');
    this.overlay.setAttribute('aria-modal', 'true');
    this.overlay.setAttribute('aria-label', 'Operation Crossroads field dossier');
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

  private options(): { seed: number; difficulty: Difficulty; preset: GraphicsPreset } {
    return { seed: this.seed, difficulty: this.difficulty, preset: this.preset };
  }

  private render(): void {
    this.overlay.style.display = 'flex';
    this.overlay.dataset.state = this.state;
    this.card.replaceChildren();

    this.card.append(this.classificationStrip(), this.briefing(), this.reconMap());
    if (this.state !== 'paused') this.card.append(this.configuration());
    this.card.append(this.actions(), this.helpPanel());
  }

  private classificationStrip(): HTMLElement {
    const strip = document.createElement('header');
    strip.className = 'menu-classification';
    strip.innerHTML =
      '<span>12TH ARMY GROUP // FIELD ORDER 01</span>' +
      '<span class="menu-classification-mark">RESTRICTED</span>' +
      '<span>ISSUED 06.06.44 // 0430 HRS</span>';
    return strip;
  }

  private briefing(): HTMLElement {
    const section = document.createElement('section');
    section.id = 'menu-dossier';
    section.className = 'menu-briefing';

    const operationCode = document.createElement('div');
    operationCode.className = 'menu-operation-code';
    operationCode.textContent = this.state === 'paused' ? 'COMMAND NET // HOLDING' : 'OPERATION // C-47';

    const title = document.createElement('h1');
    title.id = 'menu-title';
    title.innerHTML = '<span>Operation</span><strong>Crossroads</strong>';

    const sub = document.createElement('p');
    sub.id = 'menu-sub';
    if (this.state === 'paused') sub.textContent = 'Tactical situation suspended by field command';
    else if (this.state === 'won') sub.textContent = 'Objective secured // road network open';
    else if (this.state === 'lost') sub.textContent = 'Assault broken // sector remains contested';
    else sub.textContent = 'Normandy, France // June 1944';

    const rule = document.createElement('div');
    rule.className = 'menu-dossier-rule';

    const copy = document.createElement('p');
    copy.className = 'menu-briefing-copy';
    if (this.state === 'won' || this.state === 'lost') {
      copy.textContent = this.endDetail;
    } else {
      copy.textContent =
        'Take a combined-arms column through the bocage, break the village defense, and hold the road junction against the northern counterattack.';
    }

    const facts = document.createElement('dl');
    facts.className = 'menu-facts';
    facts.innerHTML =
      '<div><dt>Sector</dt><dd>Ste. Mere-Eglise</dd></div>' +
      '<div><dt>Force</dt><dd>3 Sherman / 5 infantry</dd></div>' +
      '<div><dt>Primary</dt><dd>Village crossroads</dd></div>' +
      '<div><dt>Weather</dt><dd>Broken cloud / low sun</dd></div>';

    const status = document.createElement('div');
    status.className = `menu-outcome ${this.state}`;
    if (this.state === 'won') status.textContent = 'MISSION ACCOMPLISHED';
    else if (this.state === 'lost') status.textContent = 'MISSION FAILED';

    section.append(operationCode, title, sub, rule, copy, facts);
    if (status.textContent) section.append(status);
    return section;
  }

  private reconMap(): HTMLElement {
    const map = document.createElement('aside');
    map.id = 'menu-recon-map';
    map.setAttribute('aria-label', 'Reconnaissance map of the objective area');
    map.innerHTML = `
      <div class="menu-map-grid"></div>
      <svg class="menu-map-lines" viewBox="0 0 520 680" aria-hidden="true">
        <path class="map-field" d="M-20 112 L166 76 L248 194 L86 276 Z" />
        <path class="map-field" d="M312 20 L538 84 L486 242 L286 174 Z" />
        <path class="map-field" d="M-24 382 L172 322 L232 478 L38 566 Z" />
        <path class="map-field" d="M318 356 L548 294 L526 526 L356 586 Z" />
        <path class="map-road map-road-shadow" d="M245 720 C254 586 248 492 276 364 C300 252 286 132 338 -40" />
        <path class="map-road" d="M245 720 C254 586 248 492 276 364 C300 252 286 132 338 -40" />
        <path class="map-road map-road-shadow" d="M-30 370 C112 354 182 370 276 364 C376 358 446 314 548 302" />
        <path class="map-road" d="M-30 370 C112 354 182 370 276 364 C376 358 446 314 548 302" />
        <path class="map-stream" d="M24 -20 C112 124 52 214 136 304 C224 398 132 502 206 700" />
        <g class="map-village">
          <rect x="238" y="306" width="42" height="30" /><rect x="292" y="318" width="58" height="24" />
          <rect x="212" y="364" width="48" height="27" /><rect x="292" y="370" width="38" height="34" />
          <rect x="250" y="414" width="60" height="23" /><rect x="336" y="390" width="35" height="28" />
        </g>
      </svg>
      <div class="menu-objective-pulse"><span></span></div>
      <div class="menu-map-unit player one">A</div>
      <div class="menu-map-unit player two">B</div>
      <div class="menu-map-unit enemy one">?</div>
      <div class="menu-map-unit enemy two">?</div>
      <div class="menu-map-north">N</div>
      <div class="menu-map-coord">GRID 074 628<br>PHOTO: 04 JUN 44</div>
      <div class="menu-map-caption"><span>OBJ CROWN</span><strong>VILLAGE CROSSROADS</strong></div>
    `;
    return map;
  }

  private configuration(): HTMLElement {
    const section = document.createElement('section');
    section.className = 'menu-configuration';
    const heading = document.createElement('h2');
    heading.textContent = this.state === 'main' ? 'Operation Parameters' : 'Redeployment Parameters';
    const fields = document.createElement('div');
    fields.className = 'menu-row';
    fields.append(
      this.selectField('Opposition', ['easy', 'normal', 'hard'], this.difficulty, (value) => {
        this.difficulty = value as Difficulty;
      }),
      this.selectField('Field Detail', ['low', 'high', 'ultra'], this.preset, (value) => {
        this.preset = value as GraphicsPreset;
      }),
      this.seedField(),
    );
    section.append(heading, fields);
    return section;
  }

  private actions(): HTMLElement {
    const section = document.createElement('section');
    section.className = 'menu-actions';
    const isRestart = this.state === 'won' || this.state === 'lost';
    if (this.state === 'paused') {
      section.append(
        this.button('Return to Battle', () => this.cb.onResume()),
        this.button('Restart Operation', () => this.cb.onRestart(this.options()), true),
        this.button('Withdraw to Menu', () => this.cb.onQuitToMenu(), true),
      );
    } else {
      section.append(
        this.button(isRestart ? 'Redeploy Force' : 'Commence Operation', () => {
          (isRestart ? this.cb.onRestart : this.cb.onStart)(this.options());
        }),
      );
      if (isRestart) section.append(this.button('Return to Briefing', () => this.cb.onQuitToMenu(), true));
    }
    section.append(this.button(this.helpVisible ? 'Close Field Manual' : 'Open Field Manual', () => this.toggleHelp(), true));
    return section;
  }

  private selectField(label: string, values: string[], current: string, onChange: (value: string) => void): HTMLElement {
    const wrap = document.createElement('label');
    wrap.className = 'menu-field';
    const name = document.createElement('span');
    name.textContent = label;
    const select = document.createElement('select');
    select.setAttribute('aria-label', label);
    for (const value of values) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = value.charAt(0).toUpperCase() + value.slice(1);
      option.selected = value === current;
      select.append(option);
    }
    select.addEventListener('change', () => onChange(select.value));
    wrap.append(name, select);
    return wrap;
  }

  private seedField(): HTMLElement {
    const wrap = document.createElement('label');
    wrap.className = 'menu-field';
    const name = document.createElement('span');
    name.textContent = 'Map Folio';
    const input = document.createElement('input');
    input.type = 'number';
    input.value = String(this.seed);
    input.setAttribute('aria-label', 'Map folio seed');
    input.addEventListener('change', () => {
      const value = Number(input.value);
      if (Number.isFinite(value)) this.seed = Math.floor(value);
    });
    wrap.append(name, input);
    return wrap;
  }

  private button(label: string, onClick: () => void, secondary = false): HTMLButtonElement {
    const button = document.createElement('button');
    button.className = secondary ? 'menu-btn secondary' : 'menu-btn';
    button.type = 'button';
    button.innerHTML = `<span>${label}</span><i aria-hidden="true">${secondary ? '//' : '->'}</i>`;
    button.addEventListener('click', onClick);
    return button;
  }

  private toggleHelp(): void {
    this.helpVisible = !this.helpVisible;
    this.render();
  }

  private helpPanel(): HTMLDivElement {
    const help = document.createElement('div');
    help.id = 'menu-help';
    help.style.display = this.helpVisible ? 'grid' : 'none';
    const group = (title: string, pairs: [string, string][]): string =>
      `<section><h3>${title}</h3><table>${pairs.map(([key, value]) => `<tr><td class="k">${key}</td><td>${value}</td></tr>`).join('')}</table></section>`;
    help.innerHTML =
      group('Command Net', [
        ['Tab', 'Switch tactical / tank control'], ['Esc', 'Pause dossier'], ['Space', 'Pause simulation'], ['F3', 'Diagnostics'],
      ]) +
      group('Tactical Desk', [
        ['LMB', 'Select / drag force'], ['RMB', 'Move or attack contact'], ['WASD', 'Camera-relative pan'], ['Q / E', 'Orbit map'], ['Wheel', 'Altitude'], ['A / G', 'Attack move / attack ground'], ['S / H', 'Stop / hold'],
      ]) +
      group('Tank Station', [
        ['W / S', 'Throttle / reverse'], ['A / D', 'Track steering'], ['Mouse', 'Traverse and elevate'], ['LMB / RMB', 'Main gun / machine gun'], ['Shift', 'Overdrive'], ['C', 'Camera station'],
      ]);
    return help;
  }
}
