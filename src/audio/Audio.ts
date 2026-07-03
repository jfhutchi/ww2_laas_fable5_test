/**
 * Procedural WWII battlefield audio — synthesized entirely in WebAudio, no
 * external files. Weapon reports, explosions, ricochet pings, UI/ capture
 * cues, mission stingers, tank engine loop, ambient wind and distant
 * rumble. Event-driven from the game bus with distance attenuation from
 * the active camera; starts on first user gesture per browser policy.
 */

import type { EventBus } from '../core/EventBus.ts';
import { Rng } from '../core/Random.ts';

export interface AudioListenerPose {
  x: number;
  y: number;
  z: number;
}

export class GameAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private muted: boolean;
  private rng = new Rng(0xa0d10);
  private listener: AudioListenerPose = { x: 0, y: 60, z: 0 };
  private unsubs: (() => void)[] = [];
  private engineNodes: { osc: OscillatorNode; gain: GainNode; noise: AudioBufferSourceNode } | null = null;
  private ambientStarted = false;

  constructor(muted: boolean) {
    this.muted = muted;
    const resume = (): void => {
      this.ensureContext();
      window.removeEventListener('pointerdown', resume);
      window.removeEventListener('keydown', resume);
    };
    window.addEventListener('pointerdown', resume);
    window.addEventListener('keydown', resume);
  }

  private ensureContext(): AudioContext | null {
    if (this.ctx) return this.ctx;
    try {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.5;
      this.master.connect(this.ctx.destination);
      this.startAmbient();
    } catch {
      this.ctx = null;
    }
    return this.ctx;
  }

  setListener(pose: AudioListenerPose): void {
    this.listener = pose;
  }

  attach(bus: EventBus): void {
    this.unsubs.push(
      bus.on('combat:shot', (e) => {
        const g = this.gainFor(e.x, e.z, 320);
        if (g <= 0) return;
        if (e.weapon === 'cannon') this.cannon(g);
        else if (e.weapon === 'mg') this.mgBurst(g);
        else if (e.weapon === 'rifle') this.rifleBurst(g * 0.8);
        else if (e.weapon === 'grenade') this.thump(g * 0.5, 300);
      }),
      bus.on('combat:explosion', (e) => this.explosion(this.gainFor(e.x, e.z, 520) * Math.min(1.6, e.radius * 0.3))),
      bus.on('combat:ricochet', (e) => this.ricochet(this.gainFor(e.x, e.z, 200))),
      bus.on('combat:penetrated', (e) => this.clank(this.gainFor(e.x, e.z, 260))),
      bus.on('unit:suppressed', () => this.whiz(0.2)),
      bus.on('ui:click', () => this.click(0.5)),
      bus.on('capture:state', ({ state }) => {
        if (state === 'Contested' || state === 'Enemy Recapturing') this.contestedCue(0.5);
        else if (state === 'Capturing' || state === 'Securing') this.progressCue(0.45);
      }),
      bus.on('mission:won', () => this.stinger(true)),
      bus.on('mission:lost', () => this.stinger(false)),
    );
  }

  dispose(): void {
    for (const u of this.unsubs) u();
    this.unsubs = [];
    this.stopEngine();
  }

  /** Simple inverse-distance attenuation from the camera/listener. */
  private gainFor(x: number, z: number, radius: number): number {
    const d = Math.hypot(x - this.listener.x, z - this.listener.z, this.listener.y * 0.6);
    return Math.max(0, 1 - d / radius);
  }

  // ------------------------------------------------------------ primitives

  private noiseBuffer(seconds: number): AudioBuffer | null {
    const ctx = this.ctx;
    if (!ctx) return null;
    const buf = ctx.createBuffer(1, Math.max(1, Math.floor(ctx.sampleRate * seconds)), ctx.sampleRate);
    const data = buf.getChannelData(0);
    let brown = 0;
    for (let i = 0; i < data.length; i++) {
      const white = this.rng.float() * 2 - 1;
      brown = (brown + 0.02 * white) / 1.02;
      data[i] = brown * 3.2;
    }
    return buf;
  }

  private burst(opts: {
    gain: number;
    duration: number;
    filterType: BiquadFilterType;
    freq: number;
    freqEnd?: number;
    q?: number;
    attack?: number;
  }): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.master || opts.gain <= 0.001) return;
    const buf = this.noiseBuffer(opts.duration);
    if (!buf) return;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const filter = ctx.createBiquadFilter();
    filter.type = opts.filterType;
    filter.frequency.value = opts.freq;
    if (opts.freqEnd !== undefined) {
      filter.frequency.setValueAtTime(opts.freq, ctx.currentTime);
      filter.frequency.exponentialRampToValueAtTime(Math.max(30, opts.freqEnd), ctx.currentTime + opts.duration);
    }
    filter.Q.value = opts.q ?? 0.8;
    const gain = ctx.createGain();
    const a = opts.attack ?? 0.002;
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(opts.gain, ctx.currentTime + a);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + opts.duration);
    src.connect(filter).connect(gain).connect(this.master);
    src.start();
    src.stop(ctx.currentTime + opts.duration + 0.05);
  }

  private tone(freq: number, duration: number, gain: number, type: OscillatorType = 'sine', freqEnd?: number): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.master || gain <= 0.001) return;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    if (freqEnd !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), ctx.currentTime + duration);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, ctx.currentTime);
    g.gain.linearRampToValueAtTime(gain, ctx.currentTime + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
    osc.connect(g).connect(this.master);
    osc.start();
    osc.stop(ctx.currentTime + duration + 0.05);
  }

  // --------------------------------------------------------------- voices

  private cannon(g: number): void {
    this.burst({ gain: 0.7 * g, duration: 0.5, filterType: 'lowpass', freq: 900, freqEnd: 120 });
    this.tone(70, 0.42, 0.5 * g, 'sine', 34);
  }

  private thump(g: number, freq: number): void {
    this.burst({ gain: 0.4 * g, duration: 0.25, filterType: 'lowpass', freq, freqEnd: 80 });
  }

  private mgBurst(g: number): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const rounds = 6 + this.rng.int(0, 5);
    for (let i = 0; i < rounds; i++) {
      setTimeout(() => {
        this.burst({ gain: 0.22 * g, duration: 0.05, filterType: 'bandpass', freq: 1450, q: 1.4 });
        this.tone(180, 0.05, 0.12 * g, 'square', 120);
      }, i * 68);
    }
  }

  private rifleBurst(g: number): void {
    const rounds = 2 + this.rng.int(0, 3);
    for (let i = 0; i < rounds; i++) {
      setTimeout(() => {
        this.burst({ gain: 0.2 * g, duration: 0.07, filterType: 'highpass', freq: 900 });
      }, i * 190 + this.rng.int(0, 80));
    }
  }

  private explosion(g: number): void {
    if (g <= 0.001) return;
    this.burst({ gain: 0.85 * Math.min(1, g), duration: 1.3, filterType: 'lowpass', freq: 700, freqEnd: 60, attack: 0.006 });
    this.tone(46, 0.9, 0.55 * Math.min(1, g), 'sine', 26);
  }

  private ricochet(g: number): void {
    this.tone(2400 + this.rng.range(0, 900), 0.18, 0.14 * g, 'triangle', 700);
    this.burst({ gain: 0.1 * g, duration: 0.08, filterType: 'highpass', freq: 3000 });
  }

  private clank(g: number): void {
    this.tone(320, 0.12, 0.3 * g, 'square', 90);
    this.burst({ gain: 0.24 * g, duration: 0.16, filterType: 'bandpass', freq: 800, q: 2.5 });
  }

  private whiz(g: number): void {
    this.burst({ gain: 0.12 * g, duration: 0.28, filterType: 'bandpass', freq: 3200, freqEnd: 700, q: 3 });
  }

  private click(g: number): void {
    this.tone(1250, 0.035, 0.12 * g, 'square');
  }

  private progressCue(g: number): void {
    this.tone(620, 0.1, 0.1 * g, 'sine');
    setTimeout(() => this.tone(830, 0.14, 0.1 * g, 'sine'), 110);
  }

  private contestedCue(g: number): void {
    this.tone(440, 0.16, 0.12 * g, 'sawtooth', 415);
    setTimeout(() => this.tone(415, 0.2, 0.12 * g, 'sawtooth', 392), 170);
  }

  private stinger(won: boolean): void {
    const seq = won ? [392, 494, 587, 784] : [392, 370, 311, 262];
    seq.forEach((f, i) => {
      setTimeout(() => this.tone(f, won ? 0.5 : 0.7, 0.16, won ? 'triangle' : 'sawtooth'), i * (won ? 160 : 260));
    });
  }

  // --------------------------------------------------------------- engine

  /** Tank-mode engine loop; throttle 0..1 modulates pitch and grit. */
  startEngine(): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.master || this.engineNodes) return;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = 42;
    const noise = ctx.createBufferSource();
    const buf = this.noiseBuffer(2);
    if (!buf) return;
    noise.buffer = buf;
    noise.loop = true;
    const nf = ctx.createBiquadFilter();
    nf.type = 'lowpass';
    nf.frequency.value = 240;
    const gain = ctx.createGain();
    gain.gain.value = 0.0;
    osc.connect(gain);
    noise.connect(nf).connect(gain);
    gain.connect(this.master);
    osc.start();
    noise.start();
    this.engineNodes = { osc, gain, noise };
  }

  setEngine(throttle: number, speed: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.engineNodes) return;
    const t = Math.abs(throttle);
    this.engineNodes.osc.frequency.setTargetAtTime(40 + t * 46 + speed * 2.2, ctx.currentTime, 0.18);
    this.engineNodes.gain.gain.setTargetAtTime(0.05 + t * 0.1, ctx.currentTime, 0.12);
  }

  stopEngine(): void {
    if (!this.engineNodes) return;
    try {
      this.engineNodes.osc.stop();
      this.engineNodes.noise.stop();
    } catch {
      /* already stopped */
    }
    this.engineNodes.gain.disconnect();
    this.engineNodes = null;
  }

  // -------------------------------------------------------------- ambient

  private startAmbient(): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || this.ambientStarted) return;
    this.ambientStarted = true;
    // wind: looped filtered brown noise
    const buf = this.noiseBuffer(4);
    if (!buf) return;
    const wind = ctx.createBufferSource();
    wind.buffer = buf;
    wind.loop = true;
    const wf = ctx.createBiquadFilter();
    wf.type = 'lowpass';
    wf.frequency.value = 380;
    const wg = ctx.createGain();
    wg.gain.value = 0.045;
    wind.connect(wf).connect(wg).connect(this.master);
    wind.start();
    // distant battle rumble on a jittered timer
    const rumble = (): void => {
      window.setTimeout(() => {
        this.burst({ gain: 0.09, duration: 1.8, filterType: 'lowpass', freq: 160, freqEnd: 50, attack: 0.25 });
        rumble();
      }, 6000 + this.rng.int(0, 14000));
    };
    rumble();
  }
}
