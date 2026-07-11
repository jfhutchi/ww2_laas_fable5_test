/**
 * Hero-shot harness for the visual delta loop against references/third_person.png.
 *
 * Composes the REFERENCE framing: the player Sherman on the main road just
 * south of the crossroads, camera behind it, looking north up the road at the
 * church + village core. Repositions the controlled tank precisely by reaching
 * into __ocDebug.app so every shot is comparable frame-to-frame.
 *
 *   npm run hero                       # default: z=52 approach
 *   npm run hero -- --z 36 --out shots/hero-close.png
 *   npm run hero -- --z 70 --yawdeg -90 --preset ultra
 */

import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { ensureDevServer, launchWebGPU, ocUrl } from './launch.ts';

interface Args {
  [k: string]: string | undefined;
}
function parseArgs(argv: string[]): Args {
  const out: Args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a && a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        out[key] = next;
        i++;
      } else {
        out[key] = '1';
      }
    }
  }
  return out;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const seed = Number(args['seed'] ?? 1944);
  const preset = args['preset'] ?? 'high';
  const tankX = Number(args['x'] ?? 0);
  const tankZ = Number(args['z'] ?? 52);
  // yaw so the hull faces north (-Z): TankCamera dir = (cos y, sin y) → -pi/2.
  const yaw = ((Number(args['yawdeg'] ?? -90) * Math.PI) / 180);
  const out = args['out'] ?? 'shots/hero.png';
  const camPreset = Number(args['cam'] ?? 0);

  const server = await ensureDevServer();
  const { browser } = await launchWebGPU();
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  page.on('console', (m) => {
    const t = m.text();
    if (t.startsWith('[oc]') || m.type() === 'error') console.log(`[page:${m.type()}] ${t}`);
  });
  page.on('pageerror', (e) => console.error('[pageerror]', e.message));

  const urlOpts: Parameters<typeof ocUrl>[0] = { seed, preset, mode: 'tank', debug: true, freeze: true };
  if (args['noclouds'] !== undefined) urlOpts.extra = { noclouds: '1' };
  await page.goto('about:blank', { timeout: 180000 }); // park: see battery.ts note
  await page.goto(ocUrl(urlOpts), { waitUntil: 'domcontentloaded', timeout: 180000 });
  await page.waitForFunction(() => window.__oc && (window.__oc.ready || window.__oc.error !== null), undefined, {
    timeout: 240000,
    polling: 250,
  });
  const err = await page.evaluate(() => window.__oc.error);
  if (err) throw new Error(`boot error: ${err}`);

  // Reposition the controlled Sherman to the reference spot and re-aim the cam.
  const placed = await page.evaluate(
    ({ x, z, yaw, camPreset }) => {
      interface Unit { id: number; x: number; y: number; z: number; yaw: number; vel: number; driveThrottle: number; driveSteer: number; }
      interface App {
        controlledId: number;
        game: { byId: Map<number, Unit> } | null;
        world: { sampleHeight(x: number, z: number): number };
        tankTarget: { position: { set(x: number, y: number, z: number): void }; yaw: number };
        tankCam: { snapBehind(t: unknown): void; cyclePreset(): void; aimYaw: number; aimPitch: number };
      }
      const dbg = (window as unknown as { __ocDebug?: { app: App } }).__ocDebug;
      if (!dbg) return { ok: false, reason: 'no __ocDebug' };
      const app = dbg.app;
      if (app.controlledId < 0 || !app.game) return { ok: false, reason: `no controlled tank (id=${app.controlledId})` };
      const u = app.game.byId.get(app.controlledId);
      if (!u) return { ok: false, reason: 'controlled unit missing' };
      u.x = x;
      u.z = z;
      u.y = app.world.sampleHeight(x, z);
      u.yaw = yaw;
      u.vel = 0;
      u.driveThrottle = 0;
      u.driveSteer = 0;
      app.tankTarget.position.set(u.x, u.y, u.z);
      app.tankTarget.yaw = u.yaw;
      for (let i = 0; i < camPreset; i++) app.tankCam.cyclePreset();
      app.tankCam.aimYaw = yaw;
      app.tankCam.aimPitch = -0.03;
      app.tankCam.snapBehind(app.tankTarget);
      return { ok: true, x: u.x, y: u.y, z: u.z };
    },
    { x: tankX, z: tankZ, yaw, camPreset },
  );
  console.log('[hero] placement:', JSON.stringify(placed));

  const settleFrames = Number(args['settle'] ?? 150);
  await page.evaluate(async (f) => {
    if (window.__oc.settle) await window.__oc.settle(f);
  }, settleFrames);
  mkdirSync(dirname(out), { recursive: true });
  await page.screenshot({ path: out, timeout: 180000 });
  const stats = await page.evaluate(() => JSON.stringify(window.__oc.stats));
  console.log(`[hero] wrote ${out}`);
  console.log(`[hero:stats] ${stats}`);

  await browser.close();
  server.stop();
}

main().catch((e: unknown) => {
  console.error('[hero] FAILED:', e instanceof Error ? e.message : e);
  process.exit(1);
});
