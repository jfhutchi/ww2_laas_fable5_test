import assert from 'node:assert/strict';
import { commandPathBudget, MAX_VISIBLE_COMMAND_PATHS } from '../src/game/CommandVisuals.ts';
import { boundedMeterFraction } from '../src/ui/MeterMath.ts';

assert.equal(MAX_VISIBLE_COMMAND_PATHS, 3, 'multi-unit orders use a restrained command-path budget');
assert.equal(commandPathBudget(0), 0, 'no selection draws no command paths');
assert.equal(commandPathBudget(1), 1, 'a single selected unit keeps direct route feedback');
assert.equal(commandPathBudget(8), 0, 'a full formation does not cover the battlefield in route lines');
assert.equal(boundedMeterFraction(4_000, 100), 1, 'over-heal states cannot overflow their HUD track');
assert.equal(boundedMeterFraction(-20, 100), 0, 'negative health cannot invert its HUD track');
assert.equal(boundedMeterFraction(25, 100), 0.25, 'ordinary meter values preserve their fraction');

console.log('command visual regressions: PASS');
