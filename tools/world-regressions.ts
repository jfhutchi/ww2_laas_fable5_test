import assert from 'node:assert/strict';
import { generateLayout } from '../src/world/Layout.ts';

const world = generateLayout(1944);
const southApproachPoles = world.props.filter((prop) => prop.kind === 'pole' && prop.z > 80);
assert.ok(southApproachPoles.length >= 6, `southern approach lacks landmark rhythm (${southApproachPoles.length} poles)`);

const centerDressing = world.props.filter(
  (prop) => !prop.kind.startsWith('tree-') && prop.kind !== 'bush' && Math.hypot(prop.x, prop.z) < 32,
);
assert.ok(centerDressing.length >= 8, `village objective lacks lived-in dressing (${centerDressing.length} props)`);

console.log(`world regressions: PASS (${southApproachPoles.length} approach poles / ${centerDressing.length} center props)`);
