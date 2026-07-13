import assert from 'node:assert/strict';
import { roofBreachBounds, survivingRoofSegments } from '../src/assets/RoofDamage.ts';
import { generateLayout } from '../src/world/Layout.ts';
import { worldContentHash } from '../src/world/WorldHash.ts';

assert.deepEqual(
  survivingRoofSegments(-5, 5, -1.5, 1),
  [
    { center: -3.25, width: 3.5 },
    { center: 3, width: 4 },
  ],
  'roof breaches retain tile shoulders on both sides',
);

const breachProfile = Array.from({ length: 6 }, (_, row) =>
  roofBreachBounds(8, -0.2, 0.18, row, 0.47),
);
assert.ok(
  new Set(breachProfile.map((bounds) => bounds.left.toFixed(3))).size >= 4,
  'roof breach left edge must vary across tile courses',
);
assert.ok(
  new Set(breachProfile.map((bounds) => bounds.right.toFixed(3))).size >= 4,
  'roof breach right edge must vary independently across tile courses',
);
assert.ok(
  breachProfile.every((bounds) => bounds.right - bounds.left > 1.5),
  'irregular roof breach profile must retain a visible opening',
);

const world = generateLayout(1944);
const baseHash = worldContentHash(world, () => 0);
const firstProp = world.props[0];
assert.ok(firstProp, 'deterministic world must contain staging props');
const changedPropWorld = {
  ...world,
  props: [{ ...firstProp, x: firstProp.x + 1 }, ...world.props.slice(1)],
};
assert.notEqual(
  worldContentHash(changedPropWorld, () => 0),
  baseHash,
  'world content hash must include staging props',
);
const firstBuilding = world.buildings[0];
assert.ok(firstBuilding, 'deterministic world must contain buildings');
const changedDamageWorld = {
  ...world,
  buildings: [
    { ...firstBuilding, damage: firstBuilding.damage === 'intact' ? 'damaged' as const : 'intact' as const },
    ...world.buildings.slice(1),
  ],
};
assert.notEqual(
  worldContentHash(changedDamageWorld, () => 0),
  baseHash,
  'world content hash must include building damage state',
);
const southApproachPoles = world.props.filter((prop) => prop.kind === 'pole' && prop.z > 80);
assert.ok(southApproachPoles.length >= 6, `southern approach lacks landmark rhythm (${southApproachPoles.length} poles)`);

const centerDressing = world.props.filter(
  (prop) => !prop.kind.startsWith('tree-') && prop.kind !== 'bush' && Math.hypot(prop.x, prop.z) < 32,
);
assert.ok(centerDressing.length >= 8, `village objective lacks lived-in dressing (${centerDressing.length} props)`);

console.log(`world regressions: PASS (${southApproachPoles.length} approach poles / ${centerDressing.length} center props)`);
