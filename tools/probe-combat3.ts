/** Deep dump of the AT gun's targeting pipeline during the approach. */
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
    api.debugTeleportSelection(obj.x + 4, obj.z + 320);
    api.attackMove(obj.x, obj.z);
    api.setSpeed(8);
  });
  for (let iter = 0; iter < 6; iter++) {
    await page.evaluate(async () => window.__oc.settle && (await window.__oc.settle(90)));
    const out = await page.evaluate(() => {
      interface U {
        id: number; side: string; cls: string; x: number; z: number; alive: boolean; hp: number;
        targetId: number; yaw: number; turretYaw: number; suppression: number; pinned: boolean; vel: number;
        weapons: { cooldown: number }[];
      }
      interface Dbg {
        app: {
          game: {
            units: U[];
            los: { check(q: { fromX: number; fromZ: number; fromEye: number; toX: number; toZ: number; toEye: number }): boolean };
            nav: { smoke: Uint8Array };
          };
        };
      }
      const dbg = (window as unknown as { __ocDebug?: Dbg }).__ocDebug;
      if (!dbg?.app.game) return 'no game';
      const gs = dbg.app.game;
      const at = gs.units.find((u) => u.cls === 'at-gun');
      if (!at) return 'no at-gun';
      const players = gs.units.filter((u) => u.side === 'player' && u.alive);
      const rows: string[] = [];
      for (const p of players.slice(0, 4)) {
        const d = Math.hypot(p.x - at.x, p.z - at.z);
        const los = gs.los.check({ fromX: at.x, fromZ: at.z, fromEye: 1.7, toX: p.x, toZ: p.z, toEye: 2.2 });
        rows.push(`  ${p.cls}#${p.id} d=${d.toFixed(0)} los=${los}`);
      }
      const t = window.__oc.stats?.game;
      return [
        `AT (${at.x.toFixed(1)},${at.z.toFixed(1)}) alive=${at.alive} hp=${at.hp.toFixed(0)} tgt=${at.targetId} yaw=${at.yaw.toFixed(2)} tYaw=${at.turretYaw.toFixed(2)} sup=${at.suppression.toFixed(2)} pin=${at.pinned} cd=${at.weapons[0]?.cooldown.toFixed(1)}`,
        ...rows,
        `stats: t=${t?.simTime.toFixed(0)} shotsE=${t?.shotsByEnemy} shotsP=${t?.shotsByPlayer} spotted=${t?.spottedEnemies} eAlive=${t?.enemyAlive}`,
      ].join('\n');
    });
    console.log(`--- iter ${iter} ---\n${out}`);
  }
  await browser.close();
  server.stop();
}
main().catch((e: unknown) => { console.error('FAILED', e); process.exit(1); });
