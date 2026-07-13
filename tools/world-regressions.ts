import assert from 'node:assert/strict';
import { survivingRoofSegments } from '../src/assets/RoofDamage.ts';
import { generateLayout } from '../src/world/Layout.ts';

assert.deepEqual(
  survivingRoofSegments(-5, 5, -1.5, 1),
  [
    { center: -3.25, width: 3.5 },
    { center: 3, width: 4 },
  ],
  'roof breaches retain tile shoulders on both sides',
);

const world = generateLayout(1944);
const southApproachPoles = world.props.filter((prop) => prop.kind === 'pole' && prop.z > 80);
assert.ok(southApproachPoles.length >= 6, `southern approach lacks landmark rhythm (${southApproachPoles.length} poles)`);

const centerDressing = world.props.filter(
  (prop) => !prop.kind.startsWith('tree-') && prop.kind !== 'bush' && Math.hypot(prop.x, prop.z) < 32,
);
assert.ok(centerDressing.length >= 8, `village objective lacks lived-in dressing (${centerDressing.length} props)`);

console.log(`world regressions: PASS (${southApproachPoles.length} approach poles / ${centerDressing.length} center props)`);
