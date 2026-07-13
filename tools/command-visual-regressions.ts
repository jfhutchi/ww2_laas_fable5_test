import assert from 'node:assert/strict';
import { commandPathBudget, MAX_VISIBLE_COMMAND_PATHS } from '../src/game/CommandVisuals.ts';

assert.equal(MAX_VISIBLE_COMMAND_PATHS, 3, 'multi-unit orders use a restrained command-path budget');
assert.equal(commandPathBudget(0), 0, 'no selection draws no command paths');
assert.equal(commandPathBudget(1), 1, 'a single selected unit keeps direct route feedback');
assert.equal(commandPathBudget(8), 3, 'a full formation does not cover the battlefield in route lines');

console.log('command visual regressions: PASS');
