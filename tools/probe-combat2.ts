/** Isolate enemy fire: enemies unkillable, players parked in the open. */
import { ensureDevServer, launchWebGPU, ocUrl } from './launch.ts';

async function main(): Promise<void> {
  const server = await ensureDevServer();
  const { browser } = await launchWebGPU();
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await page.goto(ocUrl({ seed: 1944, mode: 'tactical', debug: true }), { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__oc && (window.__oc.ready || window.__oc.error !== null), undefined, { timeout: 240000 });
  await page.evaluate(() => {
    const api = window.__oc.api;
    if (!api) throw new Error('no api');
    api.selectAll();
    const obj = api.objective();
    api.debugTeleportSelection(obj.x + 5, obj.z + 120);
    api.stop();
    api.debugScaleHealth('enemy', 1000);
    api.setSpeed(8);
  });
  for (let i = 0; i < 5; i++) {
    await page.evaluate(async () => window.__oc.settle && (await window.__oc.settle(120)));
    const g = await page.evaluate(() => window.__oc.stats?.game);
    console.log(`t=${g?.simTime.toFixed(0)}s shotsE=${g?.shotsByEnemy} shotsP=${g?.shotsByPlayer} hits=${g?.projectileHits} pDead=${(g?.playerUnits ?? 0) - (g?.playerAlive ?? 0)}`);
    if ((g?.shotsByEnemy ?? 0) > 0) break;
  }
  await browser.close();
  server.stop();
}
main().catch((e: unknown) => { console.error('FAILED', e); process.exit(1); });
