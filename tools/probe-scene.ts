/** Debug probe: dump scene-graph groups, road mesh stats, ground samples. */
import { ensureDevServer, launchWebGPU, ocUrl } from './launch.ts';

async function main(): Promise<void> {
  const server = await ensureDevServer();
  const { browser } = await launchWebGPU();
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('console', (m) => console.log('[page]', m.text()));
  await page.goto(ocUrl({ seed: 1944, mode: 'tactical', freeze: true, debug: true }), {
    waitUntil: 'domcontentloaded',
  });
  await page.waitForFunction(() => window.__oc && (window.__oc.ready || window.__oc.error !== null), undefined, {
    timeout: 240000,
  });
  const out = await page.evaluate(() => {
    interface DebugHandle {
      app: {
        scene: { traverse(cb: (o: { name: string; type: string; visible: boolean; parent: { name: string } | null; geometry?: { attributes?: Record<string, { count: number }>; boundingSphere?: { radius: number; center: { x: number; y: number; z: number } } | null }; count?: number }) => void): void };
        world: {
          ground: { roadMask(x: number, z: number): number; height(x: number, z: number): number; roadDistance(x: number, z: number): number };
          model: { roads: { roads: { kind: string; width: number; points: { x: number; z: number }[] }[] } };
        };
      };
    }
    const dbg = (window as unknown as { __ocDebug?: DebugHandle }).__ocDebug;
    if (!dbg) return { error: 'no __ocDebug' };
    const groups: string[] = [];
    const meshes: string[] = [];
    dbg.app.scene.traverse((o) => {
      if (o.type === 'Group') groups.push(o.name || '(anon)');
      if ((o.type === 'Mesh' || o.type === 'InstancedMesh') && o.geometry) {
        const pos = o.geometry.attributes?.['position'];
        const bs = o.geometry.boundingSphere;
        meshes.push(
          `${o.parent?.name ?? '?'}/${o.name || o.type} verts=${pos?.count ?? 0} inst=${o.count ?? 1} vis=${o.visible} bs=${bs ? `${bs.radius.toFixed(0)}@(${bs.center.x.toFixed(0)},${bs.center.y.toFixed(0)},${bs.center.z.toFixed(0)})` : 'none'}`,
        );
      }
    });
    const g = dbg.app.world.ground;
    const roads = dbg.app.world.model.roads.roads.map(
      (r) => `${r.kind} w=${r.width} pts=${r.points.length} p0=(${r.points[0]?.x.toFixed(0)},${r.points[0]?.z.toFixed(0)}) p5=(${r.points[5]?.x.toFixed(0)},${r.points[5]?.z.toFixed(0)})`,
    );
    const samples: string[] = [];
    for (const [x, z] of [[0, 0], [0, 30], [30, 0], [0, 100], [5, 60], [-40, 3]] as const) {
      samples.push(`(${x},${z}) mask=${g.roadMask(x, z).toFixed(2)} dist=${g.roadDistance(x, z).toFixed(1)} h=${g.height(x, z).toFixed(2)}`);
    }
    return { groups, meshCount: meshes.length, meshes: meshes.slice(0, 40), roads, samples };
  });
  console.log(JSON.stringify(out, null, 2));
  await browser.close();
  server.stop();
}

main().catch((e: unknown) => {
  console.error('probe FAILED:', e);
  process.exit(1);
});
