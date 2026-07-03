# Fable 5 QA / Self-Review Prompt — Operation Crossroads

Use this after Fable 5 claims the project or a phase is complete.

## Role

Act as a hostile QA lead, graphics reviewer, gameplay reviewer, and release engineer.

Assume the project is incomplete until proven otherwise.

The target is not a prototype.

The target is a complete playable WWII tactical/third-person browser game meeting the LAAS v2 benchmark and the project’s `references/` folder.

## Review Inputs

Inspect:

```text
package.json
tsconfig.json
src/
tools/
docs/
references/
shots/
README.md
```

Run:

```text
npm install
npm run typecheck
npm run build
npm run shoot
npm run compare
npm run battery
```

## Hard Failures

Fail the phase or project if any of these are present:

- WebGL fallback.
- TypeScript strict disabled.
- TypeScript `any`.
- Giant single-file architecture.
- Runtime art depends on downloaded external assets.
- Reference images ignored.
- No screenshot harness.
- No comparison outputs.
- No `docs/DELTA.md`.
- No `docs/BLOCKERS.md`.
- Open blockers in final.
- Console errors.
- Runtime exceptions.
- Unhandled promise rejections.
- Fake HUD values.
- Fake minimap.
- Fake AI.
- Fake combat.
- Fake capture logic.
- Fake damage.
- Fake line of sight.
- Cube tanks.
- Cube buildings.
- Static scene.
- No win condition.
- No loss condition.
- No tactical mode.
- No third-person tank mode.
- No playable mode switching.
- Sparse world.
- Bare near-camera ground.
- Black shadows.
- Fog used to hide missing detail.
- Screenshots do not resemble references.
- Battery test skipped or disabled.

## Required Proof

Verify that the project proves:

- WebGPU initializes.
- Deterministic seed works.
- Tactical camera screenshot exists.
- Third-person tank screenshot exists.
- Capture contested screenshot exists.
- Mission won screenshot exists.
- Mission lost screenshot exists.
- Debug HUD screenshot exists.
- Reference comparison images exist.
- Tactical mode uses real game state.
- Third-person mode uses real game state.
- Player units can be commanded.
- Enemy AI fights back.
- Projectiles hit and damage units.
- Vehicles can be destroyed.
- Wrecks persist.
- Capture zone changes state.
- Player can win.
- Player can lose.
- Minimap reflects actual unit/objective state.
- Audio plays for key events.
- Performance HUD reports real counters.

## Visual Review

Compare screenshots against all relevant images in `references/`.

For the tactical screenshot, score:

- Village/crossroads composition.
- Unit roster.
- Objective panel.
- Capture panel.
- Command panel.
- Friendly markers.
- Enemy spotted markers.
- Minimap.
- Smoke/fire/damage.
- Geometry density.
- Lighting.
- WWII readability.

For the third-person screenshot, score:

- Behind-Sherman camera composition.
- Road into village.
- Church/steeple landmark.
- Smoke/dust/war damage.
- Crosshair.
- Compass.
- Objective box.
- Circular minimap.
- Tank HUD.
- Combat moment.
- Normandy atmosphere.
- LAAS-level density.

For LAAS benchmark quality, score:

- Procedural material richness.
- Near-camera detail.
- Geometry density.
- Shadow quality.
- Ambient lighting.
- Atmospheric effects.
- No cloned scatter.
- No flat surfaces.
- No empty foreground.

## Required Output

Produce a review report:

```text
# QA Review

## Verdict
Pass / Fail

## Commands
- npm install:
- npm run typecheck:
- npm run build:
- npm run shoot:
- npm run compare:
- npm run battery:

## Hard Failures
- ...

## Gameplay Findings
- ...

## Visual Findings
- ...

## Reference Delta Findings
- ...

## Performance Findings
- ...

## Open Blockers
- ...

## Required Fixes Before Completion
1.
2.
3.
```

If the verdict is Fail, immediately implement the fixes and re-run the acceptance gate.

Do not ask the user whether to continue fixing mandatory failures.
