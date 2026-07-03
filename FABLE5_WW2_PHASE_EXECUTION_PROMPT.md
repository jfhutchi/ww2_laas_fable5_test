# Fable 5 Phase Execution Prompt — Operation Crossroads

Use this prompt when Fable 5 needs a strict execution order after accepting the master build prompt.

## Directive

Continue building **Operation Crossroads**.

The target is not a prototype.

Do not ask to reduce scope.

Proceed phase by phase.

Each phase closes only after:

```text
implementation
typecheck
build
runtime launch
screenshot capture
reference comparison
DELTA.md update
top-three delta fixes
battery coverage update
BLOCKERS.md update
```

No phase may close with fake systems or final placeholders.

## Phase 0 — Scaffold

Implement:

- Vite project.
- TypeScript strict config.
- WebGPU-only renderer.
- three.js WebGPURenderer.
- WebGPU diagnostics.
- Fail-loud unsupported browser screen.
- Main app boot flow.
- Deterministic config parser.
- Seeded PRNG.
- Time system.
- Input system.
- Basic tactical camera.
- Basic tank camera.
- HUD shell.
- Menu shell.
- Playwright launch harness.
- `references/` folder image discovery.
- Screenshot output folder.
- `docs/STATUS.md`.
- `docs/DELTA.md`.
- `docs/BLOCKERS.md`.

Close only when:

```text
npm run typecheck
npm run build
npm run shoot
```

work and screenshots are created.

## Phase 1 — World and Village

Implement:

- 1.5 km × 1.5 km playable Normandy terrain.
- 4 km horizon composition.
- Road graph.
- Crossroads.
- Village generator.
- Church with steeple.
- 30+ structures.
- Stone houses.
- Brick/plaster houses.
- Barns/sheds.
- Low stone walls.
- Hedgerows.
- Fields/orchards.
- Craters.
- Rubble.
- Road debris.
- Terrain materials.
- Lighting.
- Shadows.
- Minimap terrain data.

Close only when the tactical screenshot clearly reads as a Normandy village crossroads.

## Phase 2 — Units and Commands

Implement:

- Procedural Sherman M4A1.
- Procedural German armor.
- Rifle squads.
- Scout teams.
- AT gun.
- MG teams.
- Tactical icons.
- Health bars.
- Unit roster.
- Selection.
- Multi-selection.
- Move command.
- Attack-move command.
- Attack target.
- Attack ground.
- Stop.
- Hold position.
- Pathfinding.
- Steering.
- Formation movement.

Close only when player units can be selected and commanded.

## Phase 3 — Combat

Implement:

- Tank cannon projectile.
- MG fire.
- Rifle fire.
- Projectile hit detection.
- Armor facing.
- Penetration.
- Ricochet.
- HE blast radius.
- Infantry damage.
- Vehicle damage.
- Critical states.
- Suppression.
- Cover modifiers.
- Muzzle flashes.
- Tracers.
- Explosions.
- Impact decals.
- Craters.
- Smoke.
- Fire.
- Wrecks.
- Combat audio.

Close only when a player unit and enemy unit can damage and destroy each other.

## Phase 4 — Mission and AI

Implement:

- Capture zone.
- Capture states.
- Capture progress.
- Contested state.
- Secured state.
- Enemy recapture state.
- Objective panel.
- Win condition.
- Loss condition.
- Enemy defensive positions.
- Enemy infantry AI.
- Enemy MG AI.
- Enemy AT gun AI.
- Enemy armor AI.
- Friendly command AI.
- Reinforcement trigger at 50%.
- Line-of-sight.
- Spotted enemies.
- Fog-of-war minimap behavior.
- Tactical time controls.

Close only when the mission can be won and lost.

## Phase 5 — Third-Person Tank Mode

Implement:

- Behind-Sherman camera.
- Direct driving.
- Heavy acceleration.
- Braking.
- Turning.
- Turret aim.
- Cannon aim.
- Cannon fire.
- MG fire.
- Reload HUD.
- Health HUD.
- Speed HUD.
- Compass.
- Crosshair.
- Circular minimap.
- Damage feedback.
- Return-to-command button.
- Mode switch persistence.
- Other units continue fighting while direct mode is active.

Close only when third-person tank mode is a real playable mode, not a camera gimmick.

## Phase 6 — Visual Density and Polish

Implement:

- Dense near-camera ground detail.
- Road stones/gravel/mud.
- Tire ruts.
- Puddles.
- Craters.
- Grass/weeds.
- Field row geometry.
- Multi-layer hedgerows.
- Procedural stone walls.
- Building windows/frames/shutters.
- Roof tiles.
- Chimneys.
- Damaged facades.
- Rubble piles.
- Smoke columns.
- Dust trails.
- Tank tracks.
- Fire and embers.
- Contact shadows.
- Ambient occlusion.
- Filmic grade.
- UI polish.
- Audio polish.
- LODs and culling.

Close only when screenshots no longer look sparse, flat, toy-like, or placeholder-driven.

## Phase 7 — Release Verification

Implement and pass:

- Graphics presets.
- Debug HUD counters.
- Screenshot harness.
- Compare harness.
- Battery script.
- README.
- Controls doc.
- Gameplay doc.
- Technical notes.
- Final DELTA.
- Final BLOCKERS with zero open blockers.
- Final screenshots.

Required commands:

```text
npm install
npm run typecheck
npm run build
npm run shoot
npm run compare
npm run battery
```

Final is allowed only after all pass.

## Required Final Screenshots

Generate:

```text
shots/final/tactical_overhead.png
shots/final/third_person_tank.png
shots/final/capture_contested.png
shots/final/mission_won.png
shots/final/mission_lost.png
shots/final/debug_hud.png
shots/compare/tactical_vs_references.png
shots/compare/tank_vs_references.png
shots/compare/laas_quality_vs_current.png
```

## Response Rule

When reporting progress, do not say “complete” unless the acceptance gate for that phase passed.

Use:

```text
Phase:
Implemented:
Commands run:
Screenshots:
Reference deltas fixed:
Open blockers:
Next:
```
