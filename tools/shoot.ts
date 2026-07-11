/**
 * Screenshot tool: boots Operation Crossroads at a given seed/mode/camera,
 * waits for readiness, settles frames, captures a PNG and prints stats JSON.
 *
 * Usage:
 *   npm run shoot -- --mode tactical --out shots/tactical.png
 *   npm run shoot -- --mode tank --seed 7 --w 1920 --h 1080 --hud
 *   npm run shoot                       (default set: tactical + tank + hud)
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Page } from 'playwright';
import { ensureDevServer, launchWebGPU, ocUrl, type OcUrlOptions } from './launch.ts';

interface Args {
  [k: string]: string | boolean;
}

function parseArgs(argv: string[]): Args {
  const out: Args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string;
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        out[key] = next;
        i++;
      } else {
        out[key] = true;
      }
    }
  }
  return out;
}

function str(v: string | boolean | undefined): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

export interface ShotSpec {
  name: string;
  out: string;
  url: OcUrlOptions;
  settleFrames?: number;
  /** Sim-seconds to run (at given speed) before freezing for the capture. */
  runSimSeconds?: number;
}

export async function capture(page: Page, spec: ShotSpec, timeoutMs = 240000): Promise<string> {
  const url = ocUrl(spec.url);
  console.log(`[shoot] ${spec.name}: ${url}`);
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  const t0 = Date.now();
  await page
    .waitForFunction(() => window.__oc && (window.__oc.ready || window.__oc.error !== null), undefined, {
      timeout: timeoutMs,
      polling: 250,
    })
    .catch(async () => {
      const prog = await page.evaluate(() =>
        window.__oc ? `${window.__oc.progressMsg} (${(window.__oc.progress * 100).toFixed(0)}%)` : 'no hooks',
      );
      throw new Error(`Timed out waiting for ready; last progress: ${prog}`);
    });

  const error = await page.evaluate(() => window.__oc.error);
  if (error) {
    mkdirSync(dirname(spec.out), { recursive: true });
    await page.screenshot({ path: spec.out.replace(/\.png$/, '-FAILED.png') });
    throw new Error(`App reported fatal error:\n${error}`);
  }
  console.log(`[shoot] ready in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  if (spec.runSimSeconds && spec.runSimSeconds > 0) {
    await page.evaluate(async (secs) => {
      const oc = window.__oc;
      if (!oc.settle) return;
      // run at 4x for wall-time economy, then restore
      oc.api?.setSpeed(4);
      const frames = Math.ceil(((secs / 4) * 60) / 1);
      await oc.settle(frames);
      oc.api?.setSpeed(1);
    }, spec.runSimSeconds);
  }

  await page.evaluate(async (frames) => {
    if (window.__oc.settle) await window.__oc.settle(frames);
  }, spec.settleFrames ?? 24);

  mkdirSync(dirname(spec.out), { recursive: true });
  await page.screenshot({ path: spec.out, timeout: 180000 });
  const stats = await page.evaluate(() => JSON.stringify(window.__oc.stats));
  console.log(`[shoot] wrote ${spec.out}`);
  return stats;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const width = Number(str(args['w']) ?? 1920);
  const height = Number(str(args['h']) ?? 1080);
  const seed = Number(str(args['seed']) ?? 1944);

  const server = await ensureDevServer();
  const { browser } = await launchWebGPU();
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  page.on('console', (msg) => {
    const t = msg.text();
    if (t.startsWith('[oc]') || msg.type() === 'error') console.log(`[page:${msg.type()}] ${t}`);
  });
  page.on('pageerror', (err) => console.error('[pageerror]', err.message));

  const specs: ShotSpec[] = [];
  const mode = str(args['mode']);
  if (mode) {
    // single custom shot
    const spec: ShotSpec = {
      name: mode,
      out: str(args['out']) ?? `shots/${mode}.png`,
      url: { seed, mode, freeze: args['nofreeze'] !== true, debug: true },
    };
    if (args['hud'] === true || args['hud'] === '1') spec.url.hud = true;
    const cam = str(args['cam']);
    if (cam) spec.url.cam = cam;
    const preset = str(args['preset']);
    if (preset) spec.url.preset = preset;
    const run = str(args['run']);
    if (run) spec.runSimSeconds = Number(run);
    // --extra "k=v,k2=v2" → arbitrary URL params (debug toggles like noclouds=1)
    const extra = str(args['extra']);
    if (extra) {
      spec.url.extra = Object.fromEntries(
        extra.split(',').map((kv) => {
          const [k, v] = kv.split('=');
          return [k ?? '', v ?? '1'];
        }),
      );
    }
    specs.push(spec);
  } else {
    // default battery of framing shots — tactical frames the village crossroads
    const villageCam = '23,120,108,-0.18,0.88,45';
    specs.push(
      {
        name: 'tactical',
        out: 'shots/tactical.png',
        url: { seed, mode: 'tactical', freeze: true, debug: true, cam: villageCam },
      },
      {
        name: 'tank',
        out: 'shots/tank.png',
        url: { seed, mode: 'tank', freeze: true, debug: true },
      },
      {
        name: 'debug-hud',
        out: 'shots/debug_hud.png',
        url: { seed, mode: 'tactical', freeze: true, hud: true, debug: true, cam: villageCam },
      },
    );
  }

  const allStats: Record<string, unknown> = {};
  for (const spec of specs) {
    const stats = await capture(page, spec);
    allStats[spec.name] = JSON.parse(stats) as unknown;
    console.log(`[stats:${spec.name}] ${stats}`);
  }

  const statsOut = str(args['stats']);
  if (statsOut) {
    mkdirSync(dirname(statsOut), { recursive: true });
    writeFileSync(statsOut, JSON.stringify(allStats, null, 2));
  }

  await browser.close();
  server.stop();
  console.log('[shoot] done');
}

const isDirect = process.argv[1]?.replace(/\\/g, '/').endsWith('tools/shoot.ts') ?? false;
if (isDirect) {
  main().catch((e: unknown) => {
    console.error('[shoot] FAILED:', e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
