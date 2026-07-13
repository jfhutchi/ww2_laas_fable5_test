/**
 * Third-person tank HUD: objective box, compass strip, reticle with reload
 * ring, health/reload/speed readouts, damage-direction flashes, spotted-
 * target marker, and the return-to-command button. All values read from
 * the live controlled unit.
 */

import type { PerspectiveCamera } from 'three';
import { Vector3 } from 'three';
import type { GameState } from '../game/GameState.ts';
import { ARCHETYPES } from '../game/Types.ts';
import type { EventBus } from '../core/EventBus.ts';
import { angleDelta } from '../core/MathUtil.ts';
import { boundedMeterFraction } from './MeterMath.ts';

export interface TankHudCallbacks {
  onReturnToCommand: () => void;
}

export class TankHud {
  private root: HTMLDivElement;
  private compassTape: HTMLDivElement;
  private healthVal!: HTMLDivElement;
  private healthFill!: HTMLDivElement;
  private reloadVal!: HTMLDivElement;
  private reloadFill!: HTMLDivElement;
  private speedVal!: HTMLDivElement;
  private reticle: HTMLDivElement;
  private reloadRing: SVGCircleElement;
  private damageFlashes: HTMLDivElement[] = [];
  private targetMarker: HTMLDivElement;
  private objectiveState!: HTMLDivElement;
  private critLine!: HTMLDivElement;
  private unsub: (() => void)[] = [];
  private v = new Vector3();

  constructor(
    parent: HTMLElement,
    private gs: GameState,
    bus: EventBus,
    private controlledId: () => number,
    cb: TankHudCallbacks,
  ) {
    this.root = document.createElement('div');
    this.root.id = 'tank-hud';
    this.root.dataset['interface'] = 'armor-station';
    this.root.setAttribute('aria-label', 'Tank direct-control interface');
    parent.append(this.root);
    const station = document.createElement('div');
    station.className = 'hud-station-label tank';
    station.innerHTML = '<span>ARMOR STATION</span><strong>M4A1 // GUNNER</strong>';
    this.root.append(station);

    // objective box
    const obj = document.createElement('div');
    obj.className = 'oc-panel';
    obj.id = 'tank-objective';
    const t = document.createElement('div');
    t.className = 'oc-panel-title';
    t.textContent = 'Objective';
    const line = document.createElement('div');
    line.id = 'tank-objective-line';
    line.textContent = 'Capture the crossroads';
    this.objectiveState = document.createElement('div');
    this.objectiveState.id = 'tank-objective-state';
    obj.append(t, line, this.objectiveState);
    this.root.append(obj);

    // compass
    const compass = document.createElement('div');
    compass.id = 'tank-compass';
    this.compassTape = document.createElement('div');
    this.compassTape.id = 'compass-tape';
    const points: [string, number][] = [
      ['N', -Math.PI / 2], ['NE', -Math.PI / 4], ['E', 0], ['SE', Math.PI / 4],
      ['S', Math.PI / 2], ['SW', (3 * Math.PI) / 4], ['W', Math.PI], ['NW', (-3 * Math.PI) / 4],
    ];
    for (const [label] of points) {
      const el = document.createElement('span');
      el.textContent = label;
      el.className = label.length === 1 ? 'cardinal' : 'intercardinal';
      this.compassTape.append(el);
    }
    this.compassPoints = points;
    const needle = document.createElement('div');
    needle.id = 'compass-needle';
    needle.textContent = '▼';
    compass.append(this.compassTape, needle);
    this.root.append(compass);

    // reticle + reload ring
    this.reticle = document.createElement('div');
    this.reticle.id = 'tank-reticle';
    this.reticle.innerHTML =
      '<svg viewBox="0 0 100 100" width="120" height="120">' +
      '<circle cx="50" cy="50" r="4" fill="none" stroke="currentColor" stroke-width="1.4"/>' +
      '<line x1="50" y1="30" x2="50" y2="40" stroke="currentColor" stroke-width="1.4"/>' +
      '<line x1="50" y1="60" x2="50" y2="70" stroke="currentColor" stroke-width="1.4"/>' +
      '<line x1="30" y1="50" x2="40" y2="50" stroke="currentColor" stroke-width="1.4"/>' +
      '<line x1="60" y1="50" x2="70" y2="50" stroke="currentColor" stroke-width="1.4"/>' +
      '<circle id="reload-ring" cx="50" cy="50" r="22" fill="none" stroke="currentColor" stroke-width="2" ' +
      'stroke-dasharray="138.2" stroke-dashoffset="0" transform="rotate(-90 50 50)" opacity="0.85"/>' +
      '</svg>';
    this.root.append(this.reticle);
    const ring = this.reticle.querySelector<SVGCircleElement>('#reload-ring');
    if (!ring) throw new Error('reload ring missing');
    this.reloadRing = ring;

    // target marker
    this.targetMarker = document.createElement('div');
    this.targetMarker.id = 'tank-target-marker';
    this.targetMarker.textContent = '◆';
    this.root.append(this.targetMarker);

    // bottom readouts
    const bottom = document.createElement('div');
    bottom.className = 'oc-panel';
    bottom.id = 'tank-readouts';
    bottom.append(
      this.readout('HEALTH', (el, fill) => {
        this.healthVal = el;
        this.healthFill = fill;
      }),
      this.readout('RELOAD', (el, fill) => {
        this.reloadVal = el;
        this.reloadFill = fill;
      }),
      this.readout('SPEED', (el, fill) => {
        this.speedVal = el;
        this.speedFillUnused = fill;
      }),
    );
    this.root.append(bottom);
    const crit = document.createElement('div');
    crit.id = 'tank-crits';
    this.critLine = crit;
    this.root.append(crit);

    // return to command
    const ret = document.createElement('button');
    ret.id = 'tank-return';
    ret.className = 'menu-btn secondary';
    ret.type = 'button';
    ret.textContent = 'RETURN TO COMMAND (TAB)';
    ret.addEventListener('click', () => cb.onReturnToCommand());
    this.root.append(ret);

    // damage direction indicators (4 arcs)
    for (let i = 0; i < 4; i++) {
      const f = document.createElement('div');
      f.className = 'damage-flash';
      f.dataset['dir'] = String(i);
      this.root.append(f);
      this.damageFlashes.push(f);
    }
    this.unsub.push(
      bus.on('combat:hit', (e) => {
        const u = this.gs.byId.get(this.controlledId());
        if (!u || e.targetId !== u.id) return;
        const bearing = Math.atan2(e.z - u.z, e.x - u.x);
        const rel = angleDelta(u.yaw, bearing); // -PI..PI relative to hull
        const idx = Math.abs(rel) < Math.PI / 4 ? 0 : rel > Math.PI / 4 && rel < (3 * Math.PI) / 4 ? 1 : Math.abs(rel) > (3 * Math.PI) / 4 ? 2 : 3;
        const flash = this.damageFlashes[idx];
        if (flash) {
          flash.classList.remove('active');
          void flash.offsetWidth; // restart animation
          flash.classList.add('active');
        }
      }),
    );
  }

  private compassPoints: [string, number][] = [];
  private speedFillUnused!: HTMLDivElement;

  private readout(label: string, assign: (val: HTMLDivElement, fill: HTMLDivElement) => void): HTMLDivElement {
    const box = document.createElement('div');
    box.className = 'readout';
    const l = document.createElement('div');
    l.className = 'readout-label';
    l.textContent = label;
    const v = document.createElement('div');
    v.className = 'readout-value';
    const track = document.createElement('div');
    track.className = 'bar-track';
    const fill = document.createElement('div');
    fill.className = 'bar-fill';
    track.append(fill);
    box.append(l, v, track);
    assign(v, fill);
    return box;
  }

  destroy(): void {
    for (const u of this.unsub) u();
    this.root.remove();
  }

  setVisible(v: boolean): void {
    this.root.style.display = v ? 'block' : 'none';
  }

  update(camera: PerspectiveCamera, aimYaw: number, viewportW: number, viewportH: number, captureState: string, captureProgress: number): void {
    const u = this.gs.byId.get(this.controlledId());
    if (!u) return;
    const arch = ARCHETYPES[u.cls];

    // objective state line
    this.objectiveState.textContent =
      captureState === 'Neutral' ? 'Village center: enemy-held' : `Village center: ${captureState} ${(captureProgress * 100).toFixed(0)}%`;

    // compass: position cardinal letters by relative bearing
    for (let i = 0; i < this.compassTape.children.length; i++) {
      const el = this.compassTape.children[i] as HTMLElement;
      const p = this.compassPoints[i];
      if (!p) continue;
      const rel = angleDelta(aimYaw, p[1]);
      if (Math.abs(rel) > 1.15) {
        el.style.display = 'none';
      } else {
        el.style.display = 'inline-block';
        el.style.left = `${50 + (rel / 1.15) * 48}%`;
        el.style.opacity = String(1 - Math.abs(rel) / 1.3);
      }
    }

    // readouts
    this.healthVal.textContent = `${Math.max(0, Math.round(u.hp))} / ${arch.maxHp}`;
    const hf = boundedMeterFraction(u.hp, arch.maxHp);
    this.root.dataset['condition'] = hf < 0.3 ? 'critical' : hf < 0.6 ? 'damaged' : 'operational';
    this.healthFill.style.width = `${hf * 100}%`;
    this.healthFill.className = 'bar-fill' + (hf < 0.3 ? ' critical' : hf < 0.6 ? ' low' : '');
    const w0 = u.weapons[0];
    const reload = w0 ? w0.reloadLeft : 0;
    const reloadMax = arch.weapons[0]?.reload ?? 1;
    this.reloadVal.textContent = reload > 0.05 ? `${reload.toFixed(1)}s` : 'READY';
    this.reloadVal.className = 'readout-value' + (reload > 0.05 ? '' : ' ready');
    this.reloadFill.style.width = `${(1 - reload / reloadMax) * 100}%`;
    const kmh = Math.abs(u.vel) * 3.6;
    this.speedVal.textContent = `${kmh.toFixed(0)} km/h`;
    this.speedFillUnused.style.width = `${Math.min(100, (kmh / 30) * 100)}%`;

    // reload ring around the reticle
    const frac = reloadMax > 0 ? 1 - Math.min(1, reload / reloadMax) : 1;
    this.reloadRing.style.strokeDashoffset = String(138.2 * (1 - frac));
    this.reticle.classList.toggle('ready', reload <= 0.05);

    // crit warnings
    const crits: string[] = [];
    if (u.crits.mobility) crits.push('MOBILITY DAMAGED');
    if (u.crits.turret) crits.push('TURRET DAMAGED');
    if (u.crits.burning) crits.push('FIRE!');
    this.critLine.textContent = crits.join('  ·  ');

    // target marker: nearest spotted enemy near the aim direction
    let markX = -1;
    let markY = -1;
    let bestScore = 0.12;
    for (const t of this.gs.units) {
      if (!t.alive || t.side !== 'enemy' || !t.spotted) continue;
      const bearing = Math.atan2(t.z - u.z, t.x - u.x);
      const off = Math.abs(angleDelta(aimYaw, bearing));
      if (off > bestScore) continue;
      this.v.set(t.x, t.y + 2.2, t.z).project(camera);
      if (this.v.z > 1) continue;
      bestScore = off;
      markX = (this.v.x * 0.5 + 0.5) * viewportW;
      markY = (-this.v.y * 0.5 + 0.5) * viewportH;
    }
    if (markX >= 0) {
      this.targetMarker.style.display = 'block';
      this.targetMarker.style.transform = `translate(${markX}px, ${markY}px) translate(-50%, -100%)`;
    } else {
      this.targetMarker.style.display = 'none';
    }
  }
}
