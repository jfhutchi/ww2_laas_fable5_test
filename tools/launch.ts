/**
 * Shared Playwright launcher guaranteeing a WebGPU-capable Chromium.
 * Probes flag sets (headless first, headed fallback) and caches the winner in
 * .cache/webgpu-flags.json. WebGPU needs a secure context, so the probe runs
 * against the dev server on http://localhost:5173 — never about:blank.
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawn, type ChildProcess } from 'node:child_process';
import { resolve } from 'node:path';
import { chromium, type Browser } from 'playwright';

export interface LaunchRecipe {
  headless: boolean;
  channel?: string;
  executablePath?: string;
  args: string[];
}

const SWIFTSHADER_ARGS = [
  '--enable-unsafe-webgpu',
  '--enable-features=Vulkan',
  '--use-vulkan=swiftshader',
  '--use-webgpu-adapter=swiftshader',
];

/** Pre-installed Chromium in managed containers (may differ from the pinned Playwright build). */
const SYSTEM_CHROMIUM = '/opt/pw-browsers/chromium';

const CANDIDATES: LaunchRecipe[] = [
  { headless: true, channel: 'chromium', args: [] },
  { headless: true, channel: 'chromium', args: ['--enable-unsafe-webgpu'] },
  {
    headless: true,
    channel: 'chromium',
    args: ['--enable-unsafe-webgpu', '--use-angle=d3d11', '--enable-features=Vulkan'],
  },
  // CPU-only containers: WebGPU over SwiftShader Vulkan.
  { headless: true, channel: 'chromium', args: SWIFTSHADER_ARGS },
  { headless: true, executablePath: SYSTEM_CHROMIUM, args: SWIFTSHADER_ARGS },
  // Headless-new SwiftShader cannot allocate the WebGPU swapchain shared image
  // (SharedImageBackingFactory missing → Device Lost). Headed under Xvfb works.
  { headless: false, executablePath: SYSTEM_CHROMIUM, args: ['--no-sandbox', ...SWIFTSHADER_ARGS] },
  { headless: false, args: [] },
];

/**
 * Headed Chromium needs an X display. In containers without one, boot a
 * shared Xvfb on :99 (reused across runs via the X lockfile).
 */
async function ensureDisplay(): Promise<string | null> {
  if (process.env['DISPLAY']) return process.env['DISPLAY'];
  if (!existsSync('/usr/bin/Xvfb')) return null;
  const display = ':99';
  const lock = '/tmp/.X99-lock';
  // The lock file survives a killed Xvfb — trust it only if its pid is alive.
  let alive = false;
  if (existsSync(lock)) {
    try {
      const pid = parseInt(readFileSync(lock, 'utf8').trim(), 10);
      alive = Number.isFinite(pid) && existsSync(`/proc/${pid}`);
      if (!alive) rmSync(lock, { force: true });
    } catch {
      alive = false;
    }
  }
  if (!alive) {
    const child = spawn('Xvfb', [display, '-screen', '0', '1920x1080x24', '-nolisten', 'tcp'], {
      stdio: 'ignore',
      detached: true,
    });
    child.unref();
    await new Promise((r) => setTimeout(r, 1000));
  }
  return display;
}

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
    if (recipe.executablePath) launchOpts.executablePath = recipe.executablePath;
    if (!recipe.headless) {
      const display = await ensureDisplay();
      if (display) launchOpts.env = { ...process.env, DISPLAY: display };
    }
    browser = await chromium.launch(launchOpts);
    const page = await browser.newPage();
    await page.goto(`${BASE_URL}/__webgpu_probe__`, { waitUntil: 'domcontentloaded' });
    // Full swapchain smoke test: an adapter alone is not enough — headless
    // SwiftShader yields an adapter whose canvas swapchain cannot allocate a
    // shared image (Device Lost on first present). Clear a real canvas and
    // verify the device survives the presented frame.
    const ok = await page.evaluate(async () => {
      interface GpuLike {
        requestAdapter(): Promise<{ requestDevice(): Promise<GPUDeviceLike> } | null>;
        getPreferredCanvasFormat(): string;
      }
      interface GPUDeviceLike {
        lost: Promise<unknown>;
        queue: { submit(buf: unknown[]): void; onSubmittedWorkDone(): Promise<void> };
        createCommandEncoder(): {
          beginRenderPass(desc: unknown): { end(): void };
          finish(): unknown;
        };
      }
      const gpu = (navigator as { gpu?: GpuLike }).gpu;
      if (!gpu) return false;
      const adapter = await gpu.requestAdapter();
      if (!adapter) return false;
      try {
        const device = await adapter.requestDevice();
        const canvas = document.createElement('canvas');
        canvas.width = 64;
        canvas.height = 64;
        document.body.appendChild(canvas);
        const ctx = canvas.getContext('webgpu') as unknown as {
          configure(o: unknown): void;
          getCurrentTexture(): { createView(): unknown };
        } | null;
        if (!ctx) return false;
        ctx.configure({ device, format: gpu.getPreferredCanvasFormat(), alphaMode: 'premultiplied' });
        const enc = device.createCommandEncoder();
        const pass = enc.beginRenderPass({
          colorAttachments: [
            {
              view: ctx.getCurrentTexture().createView(),
              clearValue: { r: 0, g: 0.5, b: 0, a: 1 },
              loadOp: 'clear',
              storeOp: 'store',
            },
          ],
        });
        pass.end();
        device.queue.submit([enc.finish()]);
        await device.queue.onSubmittedWorkDone();
        // Give a potential async Device Lost a beat to surface.
        const lost = await Promise.race([
          device.lost.then(() => true),
          new Promise<false>((r) => setTimeout(() => r(false), 750)),
        ]);
        return !lost;
      } catch {
        return false;
      }
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
  // Own the actual Vite process rather than an npm/shell wrapper. On Windows,
  // killing the wrapper leaves Vite alive and keeps Rollup's native module
  // locked, breaking later reproducible installs.
  devServer = spawn(process.execPath, [resolve('node_modules/vite/bin/vite.js'), '--port', '5173', '--strictPort'], {
    stdio: 'ignore',
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
