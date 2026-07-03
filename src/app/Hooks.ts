/**
 * Test/automation hooks exposed on window.__oc for the Playwright harness.
 * Everything in here reflects REAL engine and game state — the battery
 * asserts against these values, so they must never be synthesized.
 */

export interface OcRenderStats {
  frame: number;
  fps: number;
  frameMs: number;
  drawCalls: number;
  triangles: number;
  points: number;
  lines: number;
  geometries: number;
  textures: number;
}

export interface OcGameStats {
  simTick: number;
  simTime: number;
  mode: 'menu' | 'tactical' | 'tank';
  playerUnits: number;
  enemyUnits: number;
  playerAlive: number;
  enemyAlive: number;
  spottedEnemies: number;
  projectilesLive: number;
  projectilesFired: number;
  projectileHits: number;
  unitsDestroyed: number;
  wrecks: number;
  captureState: string;
  captureProgress: number;
  missionState: 'none' | 'briefing' | 'running' | 'won' | 'lost';
  reinforcementsTriggered: boolean;
  audioEvents: number;
  shotsByPlayer: number;
  shotsByEnemy: number;
}

export interface OcStats {
  render: OcRenderStats;
  game: OcGameStats | null;
  seed: number;
  preset: string;
  /** Deterministic hash of the generated world for the given seed. */
  worldHash: number;
  errors: string[];
}

/** Real-input command surface for the battery. Issues genuine game commands. */
export interface OcTestApi {
  /** Select every living player-controllable unit. */
  selectAll(): number;
  /** Select units by archetype id substring (e.g. 'sherman'). Returns count. */
  selectType(type: string): number;
  /** Issue a move command to current selection (world coords). */
  move(x: number, z: number): void;
  /** Issue an attack-move command to current selection. */
  attackMove(x: number, z: number): void;
  /** Order selection to stop. */
  stop(): void;
  /** Set sim speed multiplier (0 = pause). */
  setSpeed(mult: number): void;
  /** Switch tactical <-> tank mode (same code path as Tab key). */
  toggleMode(): void;
  /** Start the mission from the menu (same code path as the Start button). */
  startMission(): void;
  /** Position of the capture zone centre. */
  objective(): { x: number; z: number };
  /** World-space positions of living units for targeting checks. */
  units(side: 'player' | 'enemy'): { id: number; type: string; x: number; z: number; hp: number }[];
  /** DEBUG ONLY (?debug=1): scale a side's hit points (real damage still applies). */
  debugScaleHealth(side: 'player' | 'enemy', mult: number): void;
  /** DEBUG ONLY: teleport selection near a point (skips travel time, not combat). */
  debugTeleportSelection(x: number, z: number): void;
  /** Fire the currently-controlled tank's cannon (tank mode). */
  fire(): void;
  /** Drive input for tank mode: throttle -1..1, steer -1..1 for N sim seconds. */
  drive(throttle: number, steer: number, seconds: number): void;
}

export interface OcHooks {
  ready: boolean;
  error: string | null;
  progress: number;
  progressMsg: string;
  stats: OcStats | null;
  settle: ((frames: number) => Promise<void>) | null;
  api: OcTestApi | null;
}

declare global {
  interface Window {
    __oc: OcHooks;
  }
}

export function installHooks(): OcHooks {
  const hooks: OcHooks = {
    ready: false,
    error: null,
    progress: 0,
    progressMsg: 'boot',
    stats: null,
    settle: null,
    api: null,
  };
  window.__oc = hooks;
  return hooks;
}

export function reportProgress(hooks: OcHooks, fraction: number, msg: string): void {
  hooks.progress = Math.min(1, Math.max(0, fraction));
  hooks.progressMsg = msg;
  const bar = document.getElementById('boot-progress');
  const label = document.getElementById('boot-msg');
  if (bar) bar.style.width = `${(hooks.progress * 100).toFixed(0)}%`;
  if (label) label.textContent = msg;
}

export function reportFatal(hooks: OcHooks, err: unknown): void {
  const msg = err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err);
  if (hooks.error === null) hooks.error = msg;
  // eslint-disable-next-line no-console
  console.error('[oc] FATAL:', msg);
}
