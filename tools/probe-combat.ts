/** Debug probe: enemy targeting/LOS state during a staged engagement. */
import { ensureDevServer, launchWebGPU, ocUrl } from './launch.ts';

async function main(): Promise<void> {
  const server = await ensureDevServer();
  const { browser } = await launchWebGPU();
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await page.goto(ocUrl({ seed: 1944, mode: 'tactical', debug: true }), { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__oc && (window.__oc.ready || window.__oc.error !== null), undefined, {
    timeout: 240000,
  });
  await page.evaluate(() => {
    const api = window.__oc.api;
    if (!api) throw new Error('no api');
    api.selectAll();
    const obj = api.objective();
    api.debugTeleportSelection(obj.x + 10, obj.z + 150);
    api.attackMove(obj.x, obj.z);
    api.setSpeed(8);
  });
  await page.evaluate(async () => window.__oc.settle && (await window.__oc.settle(300)));
  const out = await page.evaluate(() => {
    interface Dbg {
      app: {
        game: {
          units: {
            id: number; side: string; cls: string; x: number; z: number; alive: boolean;
            targetId: number; suppression: number; pinned: boolean; spotted: boolean;
            order: { type: string }; hp: number; turretYaw: number; yaw: number;
          }[];
          los: { check(q: { fromX: number; fromZ: number; fromEye: number; toX: number; toZ: number; toEye: number }): boolean };
        };
      };
    }
    const dbg = (window as unknown as { __ocDebug?: Dbg }).__ocDebug;
    if (!dbg?.app.game) return { error: 'no game' };
    const gs = dbg.app.game;
    const players = gs.units.filter((u) => u.side === 'player' && u.alive);
    const lines: string[] = [];
    for (const e of gs.units.filter((u) => u.side === 'enemy')) {
      let bestSee = '';
      for (const p of players) {
        const d = Math.hypot(p.x - e.x, p.z - e.z);
        if (d > 250) continue;
        const sees = gs.los.check({ fromX: e.x, fromZ: e.z, fromEye: 1.6, toX: p.x, toZ: p.z, toEye: 1.6 });
        if (sees) {
          bestSee = `SEES ${p.cls}@${d.toFixed(0)}m`;
          break;
        } else if (!bestSee) bestSee = `blocked to ${p.cls}@${d.toFixed(0)}m`;
      }
      lines.push(
        `${e.cls}#${e.id} (${e.x.toFixed(0)},${e.z.toFixed(0)}) alive=${e.alive} hp=${e.hp.toFixed(0)} tgt=${e.targetId} sup=${e.suppression.toFixed(2)} pin=${e.pinned} order=${e.order.type} ${bestSee}`,
      );
    }
    const pl = players.map((p) => `${p.cls}#${p.id} (${p.x.toFixed(0)},${p.z.toFixed(0)}) hp=${p.hp.toFixed(0)} tgt=${p.targetId}`);
    return { enemies: lines, players: pl, stats: window.__oc.stats?.game };
  });
  console.log(JSON.stringify(out, null, 2));
  await browser.close();
  server.stop();
}

main().catch((e: unknown) => {
  console.error('probe FAILED:', e);
  process.exit(1);
});
