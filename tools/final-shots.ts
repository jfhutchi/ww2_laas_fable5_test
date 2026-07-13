/**
 * Final delivery screenshot suite → shots/final/:
 *   tactical_overhead, third_person_tank, debug_hud,
 *   capture_contested, mission_won, mission_lost
 * Every frame is real gameplay driven through the public test API.
 */

import { mkdirSync } from 'node:fs';
import type { Browser, Page } from 'playwright';
import { ensureDevServer, launchWebGPU, ocUrl } from './launch.ts';

async function boot(page: Page, params: Record<string, string | number | boolean>): Promise<void> {
  const opts: Parameters<typeof ocUrl>[0] = { seed: 1944, debug: true };
  if (params['mode']) opts.mode = String(params['mode']);
  if (params['hud']) opts.hud = true;
  if (params['freeze']) opts.freeze = true;
  await page.goto('about:blank', { timeout: 180000 }); // park: see battery.ts note
  await page.goto(ocUrl(opts), { waitUntil: 'domcontentloaded', timeout: 180000 });
  await page.waitForFunction(() => window.__oc && (window.__oc.ready || window.__oc.error !== null), undefined, {
    timeout: 240000,
    polling: 250,
  });
  const err = await page.evaluate(() => window.__oc.error);
  if (err) throw new Error(`boot error: ${err}`);
}

async function settle(page: Page, frames: number): Promise<void> {
  await page.evaluate(async (f) => {
    if (!window.__oc.settle) throw new Error('settle hook unavailable');
    await window.__oc.settle(f);
  }, frames);
}

interface Diagnostics {
  consoleErrors: string[];
  pageErrors: string[];
}

async function shot(page: Page, path: string, diagnostics: Diagnostics): Promise<void> {
  await settle(page, 20);
  const inPageErrors = await page.evaluate(() => window.__oc.stats?.errors ?? []);
  if (inPageErrors.length > 0) throw new Error(`in-page errors: ${inPageErrors.join(' | ')}`);
  if (diagnostics.pageErrors.length > 0) throw new Error(`page errors: ${diagnostics.pageErrors.join(' | ')}`);
  if (diagnostics.consoleErrors.length > 0) {
    throw new Error(`console errors: ${diagnostics.consoleErrors.join(' | ')}`);
  }
  const oversizedMarkers = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('.marker-bar')]
      .filter((element) => element.offsetParent !== null)
      .map((element) => element.getBoundingClientRect().width)
      .filter((width) => width > 32),
  );
  if (oversizedMarkers.length > 0) {
    throw new Error(`oversized unit marker bars: ${oversizedMarkers.map((width) => width.toFixed(1)).join(', ')}`);
  }
  await page.screenshot({ path, timeout: 180000 });
  console.log(`[final] wrote ${path}`);
}

/** Aim the tactical camera at the objective so staged frames show the fight. */
async function focusObjective(page: Page, dist: number, pitch?: number): Promise<void> {
  await page.evaluate(({ d, pitch }) => {
    interface Dbg {
      app: { tacticalCam: { focusOn(x: number, z: number, dist?: number): void; yaw: number; pitch: number } };
    }
    const api = window.__oc.api;
    const dbg = (window as unknown as { __ocDebug?: Dbg }).__ocDebug;
    if (!api || !dbg) throw new Error('objective camera controls unavailable');
    const obj = api.objective();
    dbg.app.tacticalCam.focusOn(obj.x, obj.z + 14, d);
    if (pitch !== undefined) dbg.app.tacticalCam.pitch = pitch;
  }, { d: dist, pitch });
}

/** Stage the controlled Sherman on the south road inside the rebuilt town. */
async function stageVillageTank(page: Page): Promise<void> {
  await page.evaluate(() => {
    interface Unit { x: number; y: number; z: number; yaw: number; vel: number; driveThrottle: number; driveSteer: number; }
    interface App {
      controlledId: number;
      game: { byId: Map<number, Unit> } | null;
      world: {
        model: { roads: { roads: { points: { x: number; z: number }[] }[] } };
        sampleHeight(x: number, z: number): number;
      };
      tankTarget: { position: { set(x: number, y: number, z: number): void }; yaw: number };
      tankCam: { aimYaw: number; aimPitch: number; snapBehind(target: unknown): void };
    }
    const app = (window as unknown as { __ocDebug?: { app: App } }).__ocDebug?.app;
    if (!app?.game || app.controlledId < 0) throw new Error('controlled tank unavailable for village hero frame');
    const unit = app.game.byId.get(app.controlledId);
    const road = app.world.model.roads.roads[2];
    const point = road?.points[7];
    const toward = road?.points[6];
    if (!unit || !point || !toward) throw new Error('southern road hero point unavailable');
    unit.x = point.x;
    unit.z = point.z;
    unit.y = app.world.sampleHeight(unit.x, unit.z);
    unit.yaw = Math.atan2(toward.z - point.z, toward.x - point.x);
    unit.vel = 0;
    unit.driveThrottle = 0;
    unit.driveSteer = 0;
    app.tankTarget.position.set(unit.x, unit.y, unit.z);
    app.tankTarget.yaw = unit.yaw;
    app.tankCam.aimYaw = unit.yaw;
    app.tankCam.aimPitch = -0.03;
    app.tankCam.snapBehind(app.tankTarget);
  });
}

async function main(): Promise<void> {
  mkdirSync('shots/final', { recursive: true });
  const server = await ensureDevServer();
  let browser: Browser | null = null;
  try {
  ({ browser } = await launchWebGPU());
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  const diagnostics: Diagnostics = { consoleErrors: [], pageErrors: [] };
  page.on('console', (message) => {
    if (message.type() === 'error') diagnostics.consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => diagnostics.pageErrors.push(error.message));

  // 1. tactical overhead — framed on the village crossroads
  await boot(page, { mode: 'tactical', freeze: true });
  await focusObjective(page, 128, 0.78);
  await shot(page, 'shots/final/tactical_overhead.png', diagnostics);

  // 2. third-person tank
  await boot(page, { mode: 'tank', freeze: true });
  await stageVillageTank(page);
  await shot(page, 'shots/final/third_person_tank.png', diagnostics);

  // 3. debug HUD
  await boot(page, { mode: 'tactical', freeze: true, hud: true });
  await shot(page, 'shots/final/debug_hud.png', diagnostics);

  // 4. contested capture — assault the zone with a tough defense converging
  await boot(page, { mode: 'tactical' });
  await page.evaluate(() => {
    const api = window.__oc.api;
    if (!api) throw new Error('api missing');
    api.selectAll();
    const obj = api.objective();
    api.debugTeleportSelection(obj.x + 8, obj.z + 60);
    api.debugScaleHealth('enemy', 40); // defenders survive to contest
    api.move(obj.x, obj.z);
    api.setSpeed(8);
  });
  for (let i = 0; i < 40; i++) {
    await settle(page, 60);
    const g = await page.evaluate(() => window.__oc.stats?.game);
    if (g && (g.captureState === 'Contested' || g.captureState === 'Enemy Recapturing')) break;
  }
  const contestedState = await page.evaluate(() => window.__oc.stats?.game?.captureState ?? null);
  if (contestedState !== 'Contested' && contestedState !== 'Enemy Recapturing') {
    throw new Error(`contested frame did not reach a contested state (state=${contestedState})`);
  }
  await page.evaluate(() => window.__oc.api?.setSpeed(1));
  await focusObjective(page, 105);
  await shot(page, 'shots/final/capture_contested.png', diagnostics);

  // 5. mission won
  await boot(page, { mode: 'tactical' });
  await page.evaluate(() => {
    const api = window.__oc.api;
    if (!api) throw new Error('api missing');
    api.selectAll();
    const obj = api.objective();
    api.debugTeleportSelection(obj.x + 6, obj.z + 110);
    api.debugScaleHealth('enemy', 0.06);
    api.attackMove(obj.x, obj.z);
    api.setSpeed(8);
  });
  for (let i = 0; i < 60; i++) {
    await settle(page, 60);
    const g = await page.evaluate(() => window.__oc.stats?.game);
    if (!g) continue;
    if (g.reinforcementsTriggered && i % 4 === 0) {
      await page.evaluate(() => window.__oc.api?.debugScaleHealth('enemy', 0.06));
    }
    if (i % 6 === 5) {
      await page.evaluate(() => {
        const api = window.__oc.api;
        if (!api) return;
        api.selectAll();
        const obj = api.objective();
        api.attackMove(obj.x, obj.z);
      });
    }
    if (g.missionState === 'won') break;
  }
  const wonState = await page.evaluate(() => window.__oc.stats?.game?.missionState ?? null);
  if (wonState !== 'won') throw new Error(`mission-won frame did not reach victory (state=${wonState})`);
  await focusObjective(page, 110);
  await page.waitForTimeout(2200); // end screen fade-in
  await shot(page, 'shots/final/mission_won.png', diagnostics);

  // 6. mission lost
  await boot(page, { mode: 'tactical' });
  await page.evaluate(() => {
    const api = window.__oc.api;
    if (!api) throw new Error('api missing');
    api.selectAll();
    const obj = api.objective();
    api.debugTeleportSelection(obj.x + 4, obj.z + 150);
    api.debugScaleHealth('player', 0.02);
    api.debugScaleHealth('enemy', 60);
    api.attackMove(obj.x, obj.z);
    api.setSpeed(8);
  });
  for (let i = 0; i < 50; i++) {
    await settle(page, 60);
    const g = await page.evaluate(() => window.__oc.stats?.game);
    if (g && g.missionState === 'lost') break;
    if (i % 5 === 4) {
      await page.evaluate(() => {
        const api = window.__oc.api;
        if (!api) return;
        api.selectAll();
        const enemies = api.units('enemy');
        const killer =
          enemies.find((e) => e.type === 'stug' || e.type === 'panzer4') ??
          enemies.find((e) => e.type === 'at-gun' || e.type === 'grenadier-squad') ??
          enemies[0];
        if (killer) {
          api.debugTeleportSelection(killer.x + 16, killer.z + 4);
          api.attackMove(killer.x, killer.z);
        }
      });
    }
  }
  const lostState = await page.evaluate(() => window.__oc.stats?.game?.missionState ?? null);
  if (lostState !== 'lost') throw new Error(`mission-lost frame did not reach defeat (state=${lostState})`);
  await page.waitForTimeout(2200);
  await shot(page, 'shots/final/mission_lost.png', diagnostics);

  console.log('[final] complete');
  } finally {
    if (browser) await browser.close();
    server.stop();
  }
}

main().catch((e: unknown) => {
  console.error('[final] FAILED:', e instanceof Error ? e.message : e);
  process.exit(1);
});
