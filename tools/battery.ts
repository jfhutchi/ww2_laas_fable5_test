/**
 * Verification battery. Runs the game in a WebGPU Chromium and asserts the
 * full acceptance checklist. Checks accumulate across phases; the battery is
 * the final gate — every check must pass for delivery.
 *
 * Usage: npm run battery            (all checks)
 *        npm run battery -- --grep capture   (subset by name)
 */

import { mkdirSync } from 'node:fs';
import type { Browser, Page } from 'playwright';
import { ensureDevServer, launchWebGPU, ocUrl } from './launch.ts';

interface CheckCtx {
  browser: Browser;
  page: Page;
  consoleErrors: string[];
  pageErrors: string[];
  seed: number;
}

interface Check {
  id: string;
  name: string;
  fn: (ctx: CheckCtx) => Promise<void>;
}

const SEED = 1944;

function assert(cond: boolean, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

async function bootTo(page: Page, params: Record<string, string | number | boolean>): Promise<void> {
  const opts: Parameters<typeof ocUrl>[0] = { seed: SEED, debug: true, extra: {} };
  const extra: Record<string, string> = {};
  for (const [k, v] of Object.entries(params)) {
    if (k === 'seed') opts.seed = Number(v);
    else if (k === 'mode') opts.mode = String(v);
    else if (k === 'preset') opts.preset = String(v);
    else if (k === 'hud') opts.hud = v === true || v === '1';
    else if (k === 'freeze') opts.freeze = v === true || v === '1';
    else if (k === 'speed') opts.speed = Number(v);
    else if (k === 'difficulty') opts.difficulty = String(v);
    else extra[k] = String(v);
  }
  opts.extra = extra;
  // Park first and use long timeouts: under software rasterization the
  // outgoing page's render loop starves navigation, and a timed-out goto
  // leaves a PENDING navigation that interrupts every later goto (the
  // "interrupted by another navigation" cascade).
  await page.goto('about:blank', { timeout: 180000 });
  await page.goto(ocUrl(opts), { waitUntil: 'domcontentloaded', timeout: 180000 });
  await page.waitForFunction(
    () => window.__oc && (window.__oc.ready || window.__oc.error !== null),
    undefined,
    { timeout: 240000, polling: 250 },
  );
  const error = await page.evaluate(() => window.__oc.error);
  if (error) throw new Error(`boot error: ${error}`);
}

async function stats(page: Page): Promise<NonNullable<Window['__oc']['stats']>> {
  const s = await page.evaluate(() => window.__oc.stats);
  assert(s !== null, 'stats missing');
  return s;
}

// ---------------------------------------------------------------- checks

const checks: Check[] = [
  {
    id: 'webgpu',
    name: 'WebGPU initializes (no WebGL fallback)',
    fn: async ({ page }) => {
      await bootTo(page, { mode: 'tactical', freeze: true });
      const gpu = await page.evaluate(async () => {
        const adapter = await navigator.gpu.requestAdapter();
        return adapter !== null;
      });
      assert(gpu, 'no WebGPU adapter in page');
      const s = await stats(page);
      assert(s.render.drawCalls > 0, 'no draw calls — renderer not producing frames');
      assert(s.render.triangles > 0, 'no triangles rendered');
    },
  },
  {
    id: 'deterministic-seed',
    name: 'Deterministic seed loads reproducibly',
    fn: async ({ page }) => {
      await bootTo(page, { mode: 'tactical', freeze: true, seed: 777 });
      const a = await stats(page);
      await bootTo(page, { mode: 'tactical', freeze: true, seed: 777 });
      const b = await stats(page);
      assert(a.seed === 777 && b.seed === 777, 'seed not honored');
      assert(a.worldHash !== 0, 'worldHash not computed');
      assert(
        a.worldHash === b.worldHash,
        `same seed produced different world (hash ${a.worldHash} vs ${b.worldHash})`,
      );
      await bootTo(page, { mode: 'tactical', freeze: true, seed: 778 });
      const c = await stats(page);
      assert(c.worldHash !== a.worldHash, 'different seed produced identical world hash');
    },
  },
  {
    id: 'tactical-input-ownership',
    name: 'Right-button command gestures never rotate the tactical camera',
    fn: async ({ page }) => {
      await bootTo(page, { mode: 'tactical', freeze: true });
      await page.evaluate(async () => window.__oc.settle && (await window.__oc.settle(4)));
      const before = await page.evaluate(() => window.__oc.api?.getCameraPose() ?? null);
      assert(before !== null, 'camera pose API missing');

      await page.mouse.move(960, 540);
      await page.mouse.down({ button: 'right' });
      await page.mouse.move(1100, 600, { steps: 12 });
      await page.mouse.up({ button: 'right' });
      await page.evaluate(async () => window.__oc.settle && (await window.__oc.settle(4)));

      const after = await page.evaluate(() => window.__oc.api?.getCameraPose() ?? null);
      assert(after !== null, 'camera pose API disappeared');
      assert(
        Math.abs(after.yaw - before.yaw) < 0.001 && Math.abs(after.pitch - before.pitch) < 0.001,
        `right drag rotated camera (yaw ${before.yaw} -> ${after.yaw}, pitch ${before.pitch} -> ${after.pitch})`,
      );
    },
  },
  {
    id: 'shot-tactical',
    name: 'Tactical view screenshot captured',
    fn: async ({ page }) => {
      await bootTo(page, { mode: 'tactical', freeze: true });
      await page.evaluate(async () => window.__oc.settle && (await window.__oc.settle(12)));
      mkdirSync('shots/battery', { recursive: true });
      await page.screenshot({ path: 'shots/battery/tactical.png', timeout: 180000 });
    },
  },
  {
    id: 'shot-tank',
    name: 'Third-person tank screenshot captured',
    fn: async ({ page }) => {
      await bootTo(page, { mode: 'tank', freeze: true });
      await page.evaluate(async () => window.__oc.settle && (await window.__oc.settle(12)));
      await page.screenshot({ path: 'shots/battery/tank.png', timeout: 180000 });
    },
  },
  {
    id: 'shot-hud',
    name: 'Debug HUD screenshot captured with real counters',
    fn: async ({ page }) => {
      await bootTo(page, { mode: 'tactical', freeze: true, hud: '1' });
      await page.evaluate(async () => window.__oc.settle && (await window.__oc.settle(12)));
      const hudText = await page.evaluate(() => document.getElementById('debug-hud')?.textContent ?? '');
      assert(hudText.includes('fps'), 'debug HUD not visible');
      assert(/draws \d+/.test(hudText), 'debug HUD draw calls missing');
      const s = await stats(page);
      assert(s.render.drawCalls > 0 && s.render.triangles > 0, 'debug HUD counters not real');
      await page.screenshot({ path: 'shots/battery/debug_hud.png', timeout: 180000 });
    },
  },
  {
    id: 'graphics-presets',
    name: 'Graphics preset parameter works',
    fn: async ({ page }) => {
      await bootTo(page, { mode: 'tactical', freeze: true, preset: 'low' });
      const low = await stats(page);
      assert(low.preset === 'low', 'low preset not applied');
      await bootTo(page, { mode: 'tactical', freeze: true, preset: 'ultra' });
      const ultra = await stats(page);
      assert(ultra.preset === 'ultra', 'ultra preset not applied');
    },
  },
  {
    id: 'mission-spawns',
    name: 'Mission spawns full order of battle (3 Shermans, 3 rifle, 2 scouts vs defenders)',
    fn: async ({ page }) => {
      await bootTo(page, { mode: 'tactical', freeze: true });
      const s = await stats(page);
      assert(s.game !== null, 'game stats missing after mission start');
      const g = s.game;
      assert(g.playerUnits === 8, `expected 8 player units, got ${g.playerUnits}`);
      assert(g.enemyUnits >= 8, `expected ≥8 enemy defenders, got ${g.enemyUnits}`);
      const counts = await page.evaluate(() => {
        const api = window.__oc.api;
        if (!api) return null;
        return {
          shermans: api.selectType('sherman'),
          rifles: api.selectType('rifle'),
          scouts: api.selectType('scout'),
        };
      });
      assert(counts !== null, 'test api missing');
      assert(counts.shermans === 3, `expected 3 shermans, got ${counts.shermans}`);
      assert(counts.rifles === 3, `expected 3 rifle squads, got ${counts.rifles}`);
      assert(counts.scouts === 2, `expected 2 scout teams, got ${counts.scouts}`);
    },
  },
  {
    id: 'units-commandable',
    name: 'Units accept move orders and pathfind toward the objective',
    fn: async ({ page }) => {
      await bootTo(page, { mode: 'tactical' });
      const before = await page.evaluate(() => {
        const api = window.__oc.api;
        if (!api) return null;
        const units = api.units('player');
        const obj = api.objective();
        const avg = units.reduce((s, u) => s + Math.hypot(u.x - obj.x, u.z - obj.z), 0) / units.length;
        api.selectAll();
        // order to a staging point 260 m south of the objective — a long
        // road march that stays outside the defenders' engagement envelope
        api.move(obj.x, obj.z + 260);
        api.setSpeed(8);
        return avg;
      });
      assert(before !== null, 'test api missing');
      // run until the column has had ~200 sim-seconds of marching time
      // (slowest element is infantry at ~2.6 m/s over ~390 m)
      let after = before;
      for (let i = 0; i < 60; i++) {
        await page.evaluate(async () => window.__oc.settle && (await window.__oc.settle(60)));
        const state = await page.evaluate(() => {
          const api = window.__oc.api;
          const g = window.__oc.stats?.game;
          if (!api || !g) return null;
          const units = api.units('player');
          const obj = api.objective();
          return {
            avg: units.reduce((s, u) => s + Math.hypot(u.x - obj.x, u.z - obj.z), 0) / units.length,
            simTime: g.simTime,
          };
        });
        if (!state) continue;
        after = state.avg;
        if (after < before - 300 || state.simTime > 220) break;
      }
      assert(
        after < before - 300,
        `units did not advance (avg distance to objective ${before.toFixed(0)}m → ${after.toFixed(0)}m)`,
      );
    },
  },
  {
    id: 'combat-engagement',
    name: 'Both sides fire, projectiles hit, damage lands (real combat)',
    fn: async ({ page }) => {
      await bootTo(page, { mode: 'tactical', speed: 1 });
      await page.evaluate(() => {
        const api = window.__oc.api;
        if (!api) throw new Error('api missing');
        api.selectAll();
        // stage on the open southern approach — the AT gun's kill zone —
        // and advance up the road into the defense
        const obj = api.objective();
        api.debugTeleportSelection(obj.x + 4, obj.z + 320);
        api.attackMove(obj.x, obj.z);
        api.setSpeed(8);
      });
      let g: NonNullable<NonNullable<Window['__oc']['stats']>['game']> | null = null;
      for (let i = 0; i < 30; i++) {
        await page.evaluate(async () => window.__oc.settle && (await window.__oc.settle(60)));
        const s = await stats(page);
        g = s.game;
        if (g && g.shotsByPlayer > 0 && g.shotsByEnemy > 0 && g.projectileHits > 0) break;
      }
      assert(g !== null, 'no game stats');
      assert(g.shotsByPlayer > 0, 'no player unit ever fired');
      assert(g.shotsByEnemy > 0, 'no enemy unit ever fired');
      assert(g.projectilesFired > 0, 'no cannon projectiles were fired');
      assert(g.projectileHits > 0, 'no projectile ever hit');
      assert(g.audioEvents > 0, 'no audio events were emitted');
    },
  },
  {
    id: 'destruction-wrecks',
    name: 'Units can be destroyed; destroyed vehicles persist as wrecks',
    fn: async ({ page }) => {
      await bootTo(page, { mode: 'tactical', speed: 1 });
      await page.evaluate(() => {
        const api = window.__oc.api;
        if (!api) throw new Error('api missing');
        api.selectAll();
        const obj = api.objective();
        api.debugTeleportSelection(obj.x + 4, obj.z + 300);
        // soften the enemy so the fight resolves quickly in wall-time
        api.debugScaleHealth('enemy', 0.4);
        api.attackMove(obj.x, obj.z);
        api.setSpeed(8);
      });
      let g: NonNullable<NonNullable<Window['__oc']['stats']>['game']> | null = null;
      for (let i = 0; i < 40; i++) {
        await page.evaluate(async () => window.__oc.settle && (await window.__oc.settle(60)));
        const s = await stats(page);
        g = s.game;
        if (g && g.unitsDestroyed > 0 && g.wrecks > 0) break;
        if (i === 12) {
          // ensure a vehicle kill: send the Shermans at the enemy armor
          await page.evaluate(() => {
            const api = window.__oc.api;
            if (!api) return;
            const armor = api.units('enemy').find((u) => u.type === 'stug' || u.type === 'panzer4');
            if (armor && api.selectType('sherman') > 0) {
              api.debugTeleportSelection(armor.x + 40, armor.z + 30);
              api.attackMove(armor.x, armor.z);
            }
          });
        }
      }
      assert(g !== null, 'no game stats');
      assert(g.unitsDestroyed > 0, `no unit was destroyed (hits=${g.projectileHits}, shots P${g.shotsByPlayer}/E${g.shotsByEnemy})`);
      assert(g.wrecks > 0, 'no vehicle wreck persisted');
    },
  },
  {
    id: 'capture-and-win',
    name: 'Capture zone changes state, reinforcements trigger at 50%, player can WIN',
    fn: async ({ page }) => {
      await bootTo(page, { mode: 'tactical' });
      await page.evaluate(() => {
        const api = window.__oc.api;
        if (!api) throw new Error('api missing');
        api.selectAll();
        const obj = api.objective();
        api.debugTeleportSelection(obj.x + 6, obj.z + 120);
        // soften the defense so the assault resolves within battery wall-time
        api.debugScaleHealth('enemy', 0.06);
        api.attackMove(obj.x, obj.z);
        api.setSpeed(8);
      });
      const seenStates = new Set<string>();
      let g: NonNullable<NonNullable<Window['__oc']['stats']>['game']> | null = null;
      let rescaled = false;
      for (let i = 0; i < 60; i++) {
        await page.evaluate(async () => window.__oc.settle && (await window.__oc.settle(60)));
        const s = await stats(page);
        g = s.game;
        if (!g) continue;
        seenStates.add(g.captureState);
        // reinforcements arrive at full strength — soften them too, once
        if (g.reinforcementsTriggered && !rescaled) {
          rescaled = true;
          await page.evaluate(() => window.__oc.api?.debugScaleHealth('enemy', 0.06));
        }
        // keep pressing the objective in case units drifted off chasing targets
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
      assert(g !== null, 'no game stats');
      assert(seenStates.has('Capturing') || seenStates.has('Securing'), `capture never progressed (states seen: ${[...seenStates].join(',')})`);
      assert(g.reinforcementsTriggered, 'reinforcements never triggered at 50% capture');
      assert(g.missionState === 'won', `mission not won (state=${g.missionState}, capture=${g.captureState} ${(g.captureProgress * 100).toFixed(0)}%, seen: ${[...seenStates].join(',')})`);
    },
  },
  {
    id: 'mission-loss',
    name: 'Player force can be destroyed — mission is LOST',
    fn: async ({ page }) => {
      await bootTo(page, { mode: 'tactical' });
      await page.evaluate(() => {
        const api = window.__oc.api;
        if (!api) throw new Error('api missing');
        api.selectAll();
        const obj = api.objective();
        api.debugTeleportSelection(obj.x + 4, obj.z + 150);
        // glass player units against an unbreakable defense: the enemy's
        // real fire decides it — only the outcome is staged, not the kill
        api.debugScaleHealth('player', 0.02);
        api.debugScaleHealth('enemy', 60);
        api.attackMove(obj.x, obj.z);
        api.setSpeed(8);
      });
      let g: NonNullable<NonNullable<Window['__oc']['stats']>['game']> | null = null;
      for (let i = 0; i < 50; i++) {
        await page.evaluate(async () => window.__oc.settle && (await window.__oc.settle(60)));
        const s = await stats(page);
        g = s.game;
        if (g && g.missionState === 'lost') break;
        // survivors keep charging — no hiding from the verdict; prefer a
        // killer that can hurt any unit class (armor / AT gun)
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
      assert(g !== null, 'no game stats');
      assert(g.missionState === 'lost', `mission not lost (state=${g.missionState}, playerAlive=${g.playerAlive})`);
      assert(g.playerAlive === 0, 'loss triggered but player units still alive');
    },
  },
  {
    id: 'tank-mode',
    name: 'Direct tank control: drive moves the tank, cannon fires, mode round-trips',
    fn: async ({ page }) => {
      await bootTo(page, { mode: 'tactical' });
      const before = await page.evaluate(async () => {
        const api = window.__oc.api;
        if (!api) throw new Error('api missing');
        api.toggleMode();
        if (window.__oc.settle) await window.__oc.settle(3);
        return api.units('player').filter((u) => u.type === 'sherman').map((u) => ({ id: u.id, x: u.x, z: u.z }));
      });
      let s = await stats(page);
      assert(s.game?.mode === 'tank', `mode did not switch to tank (mode=${s.game?.mode})`);

      // drive forward for 3 sim-seconds
      await page.evaluate(() => {
        window.__oc.api?.drive(1, 0, 3);
        window.__oc.api?.setSpeed(2);
      });
      await page.evaluate(async () => window.__oc.settle && (await window.__oc.settle(150)));
      const after = await page.evaluate(() => {
        const api = window.__oc.api;
        return api ? api.units('player').filter((u) => u.type === 'sherman').map((u) => ({ id: u.id, x: u.x, z: u.z })) : [];
      });
      let moved = 0;
      for (const b of before) {
        const a = after.find((u) => u.id === b.id);
        if (a) moved = Math.max(moved, Math.hypot(a.x - b.x, a.z - b.z));
      }
      assert(moved > 6, `controlled tank did not drive (max displacement ${moved.toFixed(1)}m)`);

      // fire the cannon
      const firedBefore = (await stats(page)).game?.projectilesFired ?? 0;
      await page.evaluate(async () => {
        window.__oc.api?.fire();
        if (window.__oc.settle) await window.__oc.settle(30);
      });
      const firedAfter = (await stats(page)).game?.projectilesFired ?? 0;
      assert(firedAfter > firedBefore, `cannon did not fire (${firedBefore} → ${firedAfter})`);

      // return to command
      await page.evaluate(async () => {
        window.__oc.api?.toggleMode();
        if (window.__oc.settle) await window.__oc.settle(3);
      });
      s = await stats(page);
      assert(s.game?.mode === 'tactical', 'did not return to tactical mode');
    },
  },
  {
    id: 'minimap-live',
    name: 'Minimap renders terrain/objective and tracks real unit movement',
    fn: async ({ page }) => {
      await bootTo(page, { mode: 'tactical' });
      const hash0 = await page.evaluate(() => {
        const canvas = document.querySelector<HTMLCanvasElement>('#tactical-minimap canvas');
        if (!canvas) return null;
        const ctx = canvas.getContext('2d');
        if (!ctx) return null;
        const d = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        let h = 0;
        let nonBlank = 0;
        for (let i = 0; i < d.length; i += 97) {
          h = (h * 31 + (d[i] ?? 0)) >>> 0;
          if ((d[i] ?? 0) > 12) nonBlank++;
        }
        return { h, nonBlank };
      });
      assert(hash0 !== null, 'tactical minimap canvas missing');
      assert(hash0.nonBlank > 100, 'minimap appears blank — terrain not painted');
      // move the force and confirm the minimap image changes (live unit layer)
      await page.evaluate(() => {
        const api = window.__oc.api;
        if (!api) return;
        api.selectAll();
        const obj = api.objective();
        api.move(obj.x, obj.z + 400);
        api.setSpeed(8);
      });
      await page.evaluate(async () => window.__oc.settle && (await window.__oc.settle(240)));
      const hash1 = await page.evaluate(() => {
        const canvas = document.querySelector<HTMLCanvasElement>('#tactical-minimap canvas');
        const ctx = canvas?.getContext('2d');
        if (!canvas || !ctx) return null;
        const d = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        let h = 0;
        for (let i = 0; i < d.length; i += 97) h = (h * 31 + (d[i] ?? 0)) >>> 0;
        return h;
      });
      assert(hash1 !== null && hash1 !== hash0.h, 'minimap did not update as units moved');
    },
  },
  {
    id: 'no-errors-baseline',
    name: 'No console errors / exceptions / rejections during 20s idle run',
    fn: async (ctx) => {
      ctx.consoleErrors.length = 0;
      ctx.pageErrors.length = 0;
      await bootTo(ctx.page, { mode: 'tactical', speed: 2 });
      await ctx.page.evaluate(async () => window.__oc.settle && (await window.__oc.settle(600)));
      const s = await stats(ctx.page);
      assert(s.errors.length === 0, `in-page error hooks caught: ${s.errors.join(' | ')}`);
      assert(ctx.pageErrors.length === 0, `page exceptions: ${ctx.pageErrors.join(' | ')}`);
      assert(ctx.consoleErrors.length === 0, `console errors: ${ctx.consoleErrors.join(' | ')}`);
    },
  },
];

// ---------------------------------------------------------------- runner

async function main(): Promise<void> {
  const grep = process.argv.includes('--grep')
    ? process.argv[process.argv.indexOf('--grep') + 1]
    : undefined;

  const server = await ensureDevServer();
  const { browser } = await launchWebGPU();
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });

  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => pageErrors.push(err.message));
  page.on('crash', () => {
    // headed Chrome auto-reloads a crashed tab → the reload "interrupts" the
    // next goto with the OLD url. Make the crash visible instead of cryptic.
    console.error('[battery] PAGE CRASHED (renderer process died)');
  });

  const ctx: CheckCtx = { browser, page, consoleErrors, pageErrors, seed: SEED };

  const selected = grep ? checks.filter((c) => c.id.includes(grep) || c.name.includes(grep)) : checks;
  const results: { check: Check; ok: boolean; err?: string; ms: number }[] = [];

  for (const check of selected) {
    const t0 = Date.now();
    process.stdout.write(`[battery] ${check.id} … `);
    try {
      await check.fn(ctx);
      results.push({ check, ok: true, ms: Date.now() - t0 });
      console.log(`OK (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e);
      results.push({ check, ok: false, err, ms: Date.now() - t0 });
      console.log(`FAIL — ${err}`);
    }
  }

  await browser.close();
  server.stop();

  const passed = results.filter((r) => r.ok).length;
  console.log('\n================ BATTERY SUMMARY ================');
  for (const r of results) {
    console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.check.id.padEnd(28)} ${r.check.name}`);
    if (!r.ok && r.err) console.log(`      ↳ ${r.err}`);
  }
  console.log(`${passed}/${results.length} checks passed`);
  if (passed !== results.length) process.exit(1);
}

main().catch((e: unknown) => {
  console.error('[battery] FAILED:', e instanceof Error ? e.message : e);
  process.exit(1);
});
