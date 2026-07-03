/**
 * Deterministic runtime configuration parsed from URL parameters.
 *
 *   ?seed=N            world/mission seed (default 1944)
 *   ?preset=low|high|ultra
 *   ?mission=crossroads
 *   ?mode=tactical|tank|menu
 *   ?hud=1             debug HUD visible from boot
 *   ?cam=x,y,z,yaw,pitch,fov   initial camera pose override
 *   ?debug=1           expose debug/test API and verbose logging
 *   ?freeze=1          freeze simulation time (rendering continues)
 *   ?speed=N           initial sim speed multiplier
 *   ?difficulty=easy|normal|hard
 *   ?mute=1            start muted (audio still constructs graphs)
 */

export type GraphicsPreset = 'low' | 'high' | 'ultra';
export type StartMode = 'tactical' | 'tank' | 'menu';
export type Difficulty = 'easy' | 'normal' | 'hard';

export interface CameraPose {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  fov: number;
}

export interface Config {
  readonly seed: number;
  readonly preset: GraphicsPreset;
  readonly mission: string;
  readonly mode: StartMode;
  readonly hud: boolean;
  readonly cam: CameraPose | null;
  readonly debug: boolean;
  readonly freeze: boolean;
  readonly speed: number;
  readonly difficulty: Difficulty;
  readonly mute: boolean;
}

function parsePose(raw: string | null): CameraPose | null {
  if (!raw) return null;
  const parts = raw.split(',').map((p) => Number(p.trim()));
  if (parts.length < 5 || parts.some((n) => !Number.isFinite(n))) return null;
  return {
    x: parts[0] ?? 0,
    y: parts[1] ?? 60,
    z: parts[2] ?? 60,
    yaw: parts[3] ?? 0,
    pitch: parts[4] ?? -0.9,
    fov: parts[5] ?? 45,
  };
}

function parsePreset(raw: string | null): GraphicsPreset {
  return raw === 'low' || raw === 'high' || raw === 'ultra' ? raw : 'high';
}

function parseMode(raw: string | null): StartMode {
  return raw === 'tactical' || raw === 'tank' || raw === 'menu' ? raw : 'menu';
}

function parseDifficulty(raw: string | null): Difficulty {
  return raw === 'easy' || raw === 'normal' || raw === 'hard' ? raw : 'normal';
}

export function parseConfig(search: string = window.location.search): Config {
  const q = new URLSearchParams(search);
  const seedRaw = Number(q.get('seed'));
  return {
    seed: Number.isFinite(seedRaw) && q.get('seed') !== null ? Math.floor(seedRaw) : 1944,
    preset: parsePreset(q.get('preset')),
    mission: q.get('mission') ?? 'crossroads',
    mode: parseMode(q.get('mode')),
    hud: q.get('hud') === '1',
    cam: parsePose(q.get('cam')),
    debug: q.get('debug') === '1',
    freeze: q.get('freeze') === '1',
    speed: Number.isFinite(Number(q.get('speed'))) && q.get('speed') !== null ? Number(q.get('speed')) : 1,
    difficulty: parseDifficulty(q.get('difficulty')),
    mute: q.get('mute') === '1',
  };
}
