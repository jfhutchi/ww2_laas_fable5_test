# Fable 5 No-Compromise LAAS Contract

Use this as a second prompt after the master prompt if Fable 5 begins shrinking scope, creating placeholders, or treating the target as a prototype.

## Contract

You are not building a prototype.

You are building a complete playable production-target browser game.

The project is called:

```text
Operation Crossroads
```

It must meet the LAAS v2 benchmark from:

```text
https://github.com/Braffolk/fable5-world-demo
```

The game must use the project’s existing:

```text
references/
```

folder as the visual benchmark set.

The folder contains the user’s WWII references and LAAS benchmark references.

Do not ask for the images again.

Do not ignore them.

Do not use them as vague inspiration.

Use them for side-by-side verification and phase closure.

## Forbidden Completion Claims

Do not claim the game is complete if any of these are true:

- It is only a prototype.
- It is only a visual scene.
- It is only a tech demo.
- It has no real win condition.
- It has no real loss condition.
- It has fake AI.
- It has fake combat.
- It has fake capture logic.
- It has fake minimap state.
- It has fake HUD values.
- It has cube tanks.
- It has cube buildings.
- It has unanimated infantry placeholders.
- It has disabled tests.
- It has skipped verification.
- It has TypeScript errors.
- It has console errors.
- It has runtime exceptions.
- It has unhandled promise rejections.
- It has open blockers.
- It fails `npm run battery`.

## Required Final Systems

All of these are required:

### Engineering

- WebGPU only.
- No WebGL fallback.
- Vite.
- TypeScript strict.
- Zero `any`.
- three.js WebGPURenderer.
- Deterministic `?seed=N`.
- Modular architecture.
- Playwright screenshot harness.
- Reference comparison tooling.
- Performance/debug HUD.
- Final verification battery.

### Game

- Tactical overhead command mode.
- Third-person Sherman tank mode.
- Mode switching.
- 3 Sherman tanks.
- 3 rifle squads.
- 2 scout teams.
- Enemy infantry.
- Enemy MG teams.
- Enemy AT gun.
- Enemy armor.
- Enemy reinforcements at 50% capture.
- Capture zone.
- Win condition.
- Loss condition.
- Real combat.
- Real projectile damage.
- Real unit destruction.
- Wreck states.
- Cover.
- Suppression.
- Line of sight.
- Fog-of-war/spotted enemies.
- Pathfinding.
- Friendly commands.
- Enemy AI.

### Visual

- Normandy village.
- Crossroads.
- Church with steeple.
- Stone houses.
- Brick/plaster houses.
- Roof tiles.
- Chimneys.
- Windows.
- Shutters.
- Roads.
- Mud.
- Gravel.
- Tire ruts.
- Puddles.
- Shell craters.
- Hedgerows.
- Low stone walls.
- Fields.
- Orchards.
- Rubble.
- Smoke columns.
- Fire.
- Dust.
- Embers.
- Muzzle flashes.
- Explosions.
- Shell impacts.
- Tank tracks.
- Contact shadows.
- Ambient occlusion.
- Filmic lighting.
- Dense near-camera geometry.

### Audio

- Tank engine.
- Track movement.
- Cannon fire.
- MG fire.
- Rifle fire.
- Explosions.
- Shell impacts.
- UI clicks.
- Capture cues.
- Success cue.
- Failure cue.
- Ambient battlefield rumble.

## Reference Folder Rules

The `references/` folder is required input.

Implementation must:

1. Enumerate reference images.
2. Categorize them into tactical, tank-view, and LAAS-quality references where possible.
3. Use them in comparison tooling.
4. Generate side-by-side outputs in `shots/compare/`.
5. Track the top 10 deltas in `docs/DELTA.md`.
6. Fix the top 3 deltas before closing each phase.

Required comparison outputs:

```text
shots/compare/tactical_vs_references.png
shots/compare/tank_vs_references.png
shots/compare/laas_quality_vs_current.png
```

## Blocker Rules

`docs/BLOCKERS.md` may be used only during development.

No final delivery may contain open blockers.

Every blocker must include:

- Required feature.
- Current failure.
- Root cause.
- Implementation plan.
- Files affected.
- Test proving fix.
- Status.

Open blocker means the project is not complete.

## No Scope Reduction

Do not simplify the project into:

- A static Normandy village.
- A third-person-only tank demo.
- A tactical-only RTS mockup.
- A screenshot recreation.
- A non-interactive scene.
- A single tank driving demo.
- A UI-only prototype.
- A graphics-only benchmark.

The final must be a full game.

## Final Acceptance

Before final response, run and pass:

```text
npm install
npm run typecheck
npm run build
npm run shoot
npm run compare
npm run battery
```

Final response must include:

- Run instructions.
- Controls.
- Final screenshots.
- Final `STATUS.md`.
- Final `DELTA.md`.
- Final `BLOCKERS.md` with zero open blockers.
