import assert from 'node:assert/strict';
import { pointerButtonMask } from '../src/core/PointerButtons.ts';
import { TANK_CAMERA_PRESETS } from '../src/render/TankCamera.ts';
import { cameraRelativePan } from '../src/render/TacticalPan.ts';

const EPS = 1e-9;

assert.equal(pointerButtonMask(0), 1, 'left button owns the primary mask');
assert.equal(pointerButtonMask(1), 4, 'middle button owns the auxiliary mask');
assert.equal(pointerButtonMask(2), 2, 'right button owns the secondary mask');
assert.equal(pointerButtonMask(3), 0, 'unsupported buttons do not claim an input mask');

const northFacing = cameraRelativePan(0, 0, 1);
assert.ok(Math.abs(northFacing.x) < EPS, 'forward at yaw 0 does not strafe');
assert.ok(Math.abs(northFacing.z + 1) < EPS, 'forward at yaw 0 moves toward negative Z');

const eastFacing = cameraRelativePan(Math.PI / 2, 0, 1);
assert.ok(Math.abs(eastFacing.x + 1) < EPS, 'forward follows the view after a quarter turn');
assert.ok(Math.abs(eastFacing.z) < EPS, 'quarter-turn forward does not leak into Z');

const rightStrafe = cameraRelativePan(Math.PI / 2, 1, 0);
assert.ok(Math.abs(rightStrafe.x) < EPS, 'right strafe at a quarter turn does not leak into X');
assert.ok(Math.abs(rightStrafe.z + 1) < EPS, 'right strafe remains relative to the camera');

const chase = TANK_CAMERA_PRESETS[0];
assert.ok(chase, 'tank camera exposes a default chase preset');
assert.ok(chase.back >= 9, 'default chase camera keeps the complete vehicle in frame');
assert.ok(chase.up >= 3.4, 'default chase camera preserves battlefield context above the vehicle');
assert.ok(chase.fov >= 45 && chase.fov <= 52, 'default chase lens avoids arcade-like distortion');

console.log('control regressions: PASS');
