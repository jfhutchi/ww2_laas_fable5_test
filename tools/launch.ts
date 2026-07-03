/**
 * Shared Playwright launcher guaranteeing a WebGPU-capable Chromium.
 * Probes flag sets (headless first, headed fallback) and caches the winner in
 * .cache/webgpu-flags.json. WebGPU needs a secure context, so the probe runs
 * against the dev server on http://localhost:5173 — never about:blank.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawn, type ChildProcess } from 'node:child_process';
import { chromium, type Browser } from 'playwright';

export interface LaunchRecipe {
  headless: boolean;
  channel?: string;
  args: string[];
}

const CANDIDATES: LaunchRecipe[] = [
  { headless: true, channel: 'chromium', args: [] },
  { headless: true, channel: 'chromium', args: ['--enable-unsafe-webgpu'] },
  {
    headless: true,
    channel: 'chromium',
    args: ['--enable-unsafe-webgpu', '--use-angle=d3d11', '--enable-features=Vulkan'],
  },
  { headless: false, args: [] },
];

const CACHE_PATH = '.cache/webgpu-flags.json';
export const BASE_URL = 'http://localhost:5173';

async function probeRecipe(recipe: LaunchRecipe): Promise<Browser | null> {
  let browser: Browser | null = null;
  try {
    const launchOpts: Parameters<typeof chromium.launch>[0] = {
      headless: recipe.headless,
      args: recipe.args,
    };
    if (recipe.channel) launchOpts.channel = recipe.channel;
    browser = await chromium.launch(launchOpts);
    const page = await browser.newPage();
    await page.goto(`${BASE_URL}/__webgpu_probe__`, { waitUntil: 'domcontentloaded' });
    const ok = await page.evaluate(async () => {
      const gpu = (navigator as { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
      if (!gpu) return false;
      const adapter = await gpu.requestAdapter();
      return adapter !== null;
    });
    await page.close();
    if (ok) return browser;
    await browser.close();
    return null;
  } catch {
    if (browser) await browser.close().catch(() => undefined);
    return null;
  }
}

export async function launchWebGPU(): Promise<{ browser: Browser; recipe: LaunchRecipe }> {
  try {
    const cached = JSON.parse(readFileSync(CACHE_PATH, 'utf8')) as LaunchRecipe;
    const browser = await probeRecipe(cached);
    if (browser) return { browser, recipe: cached };
  } catch {
    /* no cache yet */
  }
  for (const recipe of CANDIDATES) {
    const browser = await probeRecipe(recipe);
    if (browser) {
      mkdirSync('.cache', { recursive: true });
      writeFileSync(CACHE_PATH, JSON.stringify(recipe, null, 2));
      console.log(
        `[launch] WebGPU OK — headless=${recipe.headless} channel=${recipe.channel ?? 'default'} args=[${recipe.args.join(' ')}]`,
      );
      return { browser, recipe };
    }
  }
  throw new Error(
    'No Chromium launch recipe produced a WebGPU adapter. The dev server must be running on :5173 ' +
      '(secure-context probe). Tried channel:chromium headless (with flag variants) and headed.',
  );
}

let devServer: ChildProcess | null = null;

async function pingServer(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE_URL}/`, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Ensure a Vite dev server is listening on :5173, spawning `npm run dev`
 * if needed. Returns a stop() that kills the server only if we started it.
 */
export async function ensureDevServer(): Promise<{ stop: () => void }> {
  if (await pingServer()) return { stop: () => undefined };
  console.log('[launch] starting dev server…');
  devServer = spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'dev'], {
    stdio: 'ignore',
    shell: process.platform === 'win32',
    detached: false,
  });
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    if (await pingServer()) {
      console.log('[launch] dev server up');
      return {
        stop: () => {
          devServer?.kill();
          devServer = null;
        },
      };
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('Dev server did not come up on :5173 within 60s');
}

export interface OcUrlOptions {
  seed?: number;
  preset?: string;
  mission?: string;
  mode?: string;
  hud?: boolean;
  cam?: string;
  debug?: boolean;
  freeze?: boolean;
  speed?: number;
  difficulty?: string;
  extra?: Record<string, string>;
}

export function ocUrl(opts: OcUrlOptions, base = `${BASE_URL}/`): string {
  const q = new URLSearchParams();
  if (opts.seed !== undefined) q.set('seed', String(opts.seed));
  if (opts.preset) q.set('preset', opts.preset);
  if (opts.mission) q.set('mission', opts.mission);
  if (opts.mode) q.set('mode', opts.mode);
  if (opts.hud) q.set('hud', '1');
  if (opts.cam) q.set('cam', opts.cam);
  if (opts.debug) q.set('debug', '1');
  if (opts.freeze) q.set('freeze', '1');
  if (opts.speed !== undefined) q.set('speed', String(opts.speed));
  if (opts.difficulty) q.set('difficulty', opts.difficulty);
  q.set('mute', '1'); // harness runs are always muted
  for (const [k, v] of Object.entries(opts.extra ?? {})) q.set(k, v);
  return `${base}?${q.toString()}`;
}
