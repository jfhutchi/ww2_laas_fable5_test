/** Isolate the road mesh: hide other groups, screenshot, report geometry. */
import { ensureDevServer, launchWebGPU, ocUrl } from './launch.ts';

async function main(): Promise<void> {
  const server = await ensureDevServer();
  const { browser } = await launchWebGPU();
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.goto(ocUrl({ seed: 1944, mode: 'tactical', freeze: true, debug: true, cam: '0,150,90,0,1.04,50' }), {
    waitUntil: 'domcontentloaded',
  });
  await page.waitForFunction(() => window.__oc && (window.__oc.ready || window.__oc.error !== null), undefined, {
    timeout: 240000,
  });
  const info = await page.evaluate(() => {
    interface Obj {
      name: string;
      type: string;
      visible: boolean;
      geometry?: {
        index: { count: number } | null;
        attributes: Record<string, { count: number; array: ArrayLike<number> }>;
      };
      material?: { name?: string; vertexColors?: boolean; side?: number };
    }
    interface DebugHandle {
      app: { scene: { traverse(cb: (o: Obj) => void): void }; world: { group: { children: { name: string; visible: boolean }[] } } };
    }
    const dbg = (window as unknown as { __ocDebug?: DebugHandle }).__ocDebug;
    if (!dbg) return { error: 'no debug' };
    let roadInfo: Record<string, unknown> = {};
    dbg.app.scene.traverse((o) => {
      if (o.type === 'Mesh' && o.geometry && o.material && o.material.name === 'roads') {
        const pos = o.geometry.attributes['position'];
        const col = o.geometry.attributes['color'];
        const sample: number[] = [];
        for (let i = 0; i < 12; i++) sample.push(Number((pos?.array[i] ?? NaN).toFixed?.(2) ?? pos?.array[i]));
        const csample: number[] = [];
        for (let i = 0; i < 12; i++) csample.push(Number((col?.array[i] ?? NaN).toFixed?.(3) ?? col?.array[i]));
        let nan = 0;
        const arr = pos?.array ?? [];
        for (let i = 0; i < arr.length; i++) if (!Number.isFinite(arr[i] ?? 0)) nan++;
        roadInfo = {
          idxCount: o.geometry.index?.count ?? -1,
          posCount: pos?.count,
          nanCount: nan,
          firstPositions: sample,
          firstColors: csample,
        };
      }
    });
    // hide everything except roads group
    for (const child of dbg.app.world.group.children) {
      if (child.name !== 'roads' && child.name !== '') child.visible = false;
    }
    return roadInfo;
  });
  console.log('ROAD INFO:', JSON.stringify(info));
  await page.evaluate(async () => window.__oc.settle && (await window.__oc.settle(10)));
  await page.screenshot({ path: 'shots/debug-roads-only.png' });
  console.log('wrote shots/debug-roads-only.png');
  await browser.close();
  server.stop();
}

main().catch((e: unknown) => {
  console.error('probe FAILED:', e);
  process.exit(1);
});
