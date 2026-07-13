import assert from 'node:assert/strict';
import { Box3, Mesh, Vector3 } from 'three';

const imageStub = {
  addEventListener: (_type: string, _listener: EventListener): void => undefined,
  removeEventListener: (_type: string, _listener: EventListener): void => undefined,
  set src(_value: string) {},
};
Object.defineProperty(globalThis, 'document', {
  value: { createElementNS: () => imageStub },
  configurable: true,
});

const { buildSherman } = await import('../src/assets/TankGenerator.ts');
const { buildSoldierGeometry } = await import('../src/assets/InfantryGenerator.ts');

const rig = buildSherman(1944);
for (const name of ['sherman-running-gear', 'sherman-hull', 'sherman-turret', 'sherman-main-gun']) {
  assert.ok(rig.group.getObjectByName(name), `Sherman component missing: ${name}`);
}

let triangles = 0;
rig.group.traverse((object) => {
  const mesh = object as Mesh;
  if (!mesh.isMesh) return;
  const position = mesh.geometry.getAttribute('position');
  triangles += mesh.geometry.index ? mesh.geometry.index.count / 3 : position.count / 3;
});
assert.ok(triangles > 5_000, `Sherman hero mesh is under-detailed (${triangles} triangles)`);

const size = new Box3().setFromObject(rig.group).getSize(new Vector3());
assert.ok(size.x > 6.5 && size.x < 9, `Sherman total length is implausible (${size.x.toFixed(2)}m)`);
assert.ok(size.y > 2.6 && size.y < 4.5, `Sherman height is implausible (${size.y.toFixed(2)}m)`);
assert.ok(size.z > 2.4 && size.z < 3.6, `Sherman width is implausible (${size.z.toFixed(2)}m)`);

const soldier = buildSoldierGeometry('us', 'stand', 1944);
const soldierPositions = soldier.getAttribute('position');
const soldierTriangles = soldier.index ? soldier.index.count / 3 : soldierPositions.count / 3;
assert.ok(soldierTriangles > 1_200, `hero infantry silhouette is under-detailed (${soldierTriangles} triangles)`);
soldier.computeBoundingBox();
assert.ok(soldier.boundingBox, 'soldier geometry exposes measurable bounds');
const soldierSize = soldier.boundingBox.getSize(new Vector3());
assert.ok(soldierSize.y > 1.55 && soldierSize.y < 2, `standing infantry height is implausible (${soldierSize.y.toFixed(2)}m)`);

console.log(`vehicle regressions: PASS (${Math.round(triangles)} tank / ${Math.round(soldierTriangles)} soldier triangles)`);
