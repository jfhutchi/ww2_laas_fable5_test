/** Stage an assault and capture a mid-firefight tactical frame. */
import { ensureDevServer, launchWebGPU, ocUrl } from './launch.ts';

async function main(): Promise<void> {
  const server = await ensureDevServer();
  const { browser } = await launchWebGPU();
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await page.goto(ocUrl({ seed: 1944, mode: 'tactical', debug: true }), { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__oc && (window.__oc.ready || window.__oc.error !== null), undefined, { timeout: 240000 });
  await page.evaluate(() => {
    const api = window.__oc.api;
    if (!api) throw new Error('no api');
    api.selectAll();
    const obj = api.objective();
    api.debugTeleportSelection(obj.x + 4, obj.z + 260);
    api.attackMove(obj.x, obj.z);
    api.setSpeed(8);
  });
  // run until a firefight is underway
  for (let i = 0; i < 20; i++) {
    await page.evaluate(async () => window.__oc.settle && (await window.__oc.settle(60)));
    const g = await page.evaluate(() => window.__oc.stats?.game);
    if (g && g.shotsByEnemy > 2 && g.projectilesLive + g.shotsByPlayer > 4) break;
  }
  // slow to normal so FX are on screen, focus camera on the fight
  await page.evaluate(async () => {
    const api = window.__oc.api;
    api?.setSpeed(1);
    interface Dbg { app: { tacticalCam: { focusOn(x: number, z: number, d?: number): void } } }
    const dbg = (window as unknown as { __ocDebug?: Dbg }).__ocDebug;
    const units = api?.units('player') ?? [];
    if (units.length > 0 && dbg) {
      const cx = units.reduce((s, u) => s + u.x, 0) / units.length;
      const cz = units.reduce((s, u) => s + u.z, 0) / units.length;
      dbg.app.tacticalCam.focusOn(cx, cz - 40, 110);
    }
    if (window.__oc.settle) await window.__oc.settle(40);
  });
  await page.screenshot({ path: 'shots/combat.png' });
  console.log('wrote shots/combat.png');
  const g = await page.evaluate(() => JSON.stringify(window.__oc.stats?.game));
  console.log(g);
  await browser.close();
  server.stop();
}
main().catch((e: unknown) => { console.error('FAILED', e); process.exit(1); });
