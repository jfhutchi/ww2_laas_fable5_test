# Fable 5 Master Build Prompt — Operation Crossroads

Paste this entire prompt into Claude Fable 5 from the root of the project workspace.

## Mission

You are Claude Fable 5 operating as an autonomous senior game engineer, rendering engineer, technical artist, gameplay programmer, QA lead, and release engineer.

Create a complete playable World War II browser game called **Operation Crossroads**.

This is **not a prototype**.  
This is **not a visual mockup**.  
This is **not a proof of concept**.  
This is **not a small demo**.  
This is a complete, playable, winnable, losable, polished tactical/third-person WWII game.

The game must use the uploaded/reference image set in the project’s `references/` folder and must meet or exceed the engineering and graphics benchmark of this repository:

```text
https://github.com/Braffolk/fable5-world-demo
```

You must read and apply the benchmark project’s relevant files before implementation:

```text
README.md
PROJECT_LAAS_v2.md
STATUS.md
docs/THREE-NOTES.md, if present
package.json
src/ structure
tools/ verification harness
```

The standard to apply is the **LAAS v2 production benchmark**, translated into a WWII Normandy combined-arms game.

The result must be a real browser game using WebGPU, TypeScript strict mode, Vite, three.js WebGPURenderer, procedural runtime assets, deterministic generation, reference comparison, full verification tooling, and phase-gated acceptance.

## Existing Reference Folder

The project workspace already includes a folder:

```text
references/
```

Use every image in `references/` as a required visual reference.

The folder contains the user’s WWII reference images and reference images from the LAAS benchmark project.

Do not ask the user to re-upload these images.

Do not ignore this folder.

Do not treat the images as loose mood boards. They are target compositions and quality references.

Use the reference images for:

1. Visual target analysis.
2. Side-by-side screenshot comparison.
3. `docs/DELTA.md` tracking.
4. Phase closure gates.
5. Final acceptance.

Do not copy reference images directly into runtime game textures, models, skyboxes, billboards, or UI art unless specifically used only inside the comparison/debug tooling. Runtime game content must be procedurally generated in code.

## Core Game Pitch

A single-player WWII combined-arms mission set in a procedural Normandy village.

The player commands a small American force to capture and hold a village crossroads defended by German infantry, anti-tank guns, machine-gun teams, and armor.

The same mission must be playable in two connected modes:

1. **Tactical command mode** — overhead/isometric RTS-style command view.
2. **Third-person tank mode** — direct over-the-shoulder control of a Sherman tank.

The player can switch between modes at any time.

The game must include real gameplay systems:

- Mission start.
- Unit selection.
- Movement commands.
- Combat.
- Projectile simulation.
- Damage.
- Armor facing.
- Cover.
- Suppression.
- Line of sight.
- AI.
- Capture zone.
- Win condition.
- Loss condition.
- Minimap.
- HUD.
- Pause/speed controls.
- Third-person tank control.
- Verification scripts.
- Final screenshots.

## Non-Negotiable Production Standard

This project has no accepted compromises.

Do not reduce scope.

Do not substitute a screenshot for gameplay.

Do not build a static scene.

Do not build a toy prototype.

Do not fake systems.

Do not create placeholder cubes for final assets.

Do not mark a system complete unless it works in-game.

Do not close a phase with unfinished required features.

Do not describe a limitation as acceptable if it breaks the stated target.

Do not hide missing detail with fog, darkness, blur, camera distance, or UI overlays.

Do not downgrade required features into documentation.

Do not use these phrases as escape hatches:

```text
if feasible
optional
stretch goal
future work
nearest alternative
nice to have
can be added later
prototype
MVP
placeholder acceptable
good enough
```

If a requirement is blocked, the project is not complete.

If a requirement is difficult, continue implementing until it is solved.

If a rendering feature is difficult, implement it.

If a gameplay feature is difficult, implement it.

If performance breaks, optimize until it passes.

If screenshots do not match the references closely enough, iterate until they do.

If the build fails, fix it.

If the mission cannot be won and lost through real gameplay, the project fails.

If tactical mode or third-person mode is shallow, the project fails.

If the result looks like a toy prototype, the project fails.

The only acceptable documentation for incomplete work is:

```text
docs/BLOCKERS.md
```

Blockers are not accepted final limitations. They are active defects that must be resolved before completion.

`docs/BLOCKERS.md` must use this structure:

```text
# Blockers

## Blocker ID
- Required feature:
- Current failure:
- Root cause:
- Implementation plan:
- Files affected:
- Test proving fix:
- Status: Open / Fixed
```

Final delivery may contain **zero open blockers**.

## LAAS v2 Compliance Layer

Treat `PROJECT_LAAS_v2.md` from the benchmark repository as mandatory operating law.

Apply its standard directly to this WWII game.

Required:

1. WebGPU only.
2. No WebGL fallback.
3. Fail loudly with diagnostics if WebGPU is unavailable.
4. TypeScript strict mode.
5. Zero TypeScript `any`.
6. Vite project.
7. three.js WebGPURenderer.
8. Deterministic generation from `?seed=N`.
9. Procedural runtime assets only.
10. No downloaded external art/model/audio dependencies.
11. Geometry-first detail.
12. Dense near-camera world detail.
13. No bare flat terrain within 10 meters of the camera.
14. No black ambient shadows.
15. No fog/darkness used to hide missing detail.
16. No cloned-looking scatter patterns.
17. Modular source architecture.
18. Playwright screenshot harness.
19. Reference comparison loop.
20. Performance/debug HUD.
21. Phase-gated verification.
22. Final build must pass typecheck, build, runtime, screenshot, comparison, and gameplay battery.

Translate LAAS forest/alpine density into WWII Normandy density without reducing the bar:

- Forest floor density becomes cratered roads, mud, gravel, grass, weeds, rubble, tire ruts, puddles, shell fragments, vehicle tracks, spent casings, stones, and debris.
- Tree density becomes bocage, orchards, shrubs, hedgerows, field rows, roadside trees, gardens, and overgrowth.
- Terrain richness becomes roads, crossroads, ditches, embankments, field boundaries, stone walls, village yards, rubble piles, damaged buildings, trenches, and shell craters.
- Volumetric atmosphere becomes smoke columns, cannon smoke, muzzle smoke, dust clouds, fire, embers, explosion debris, and battlefield haze.
- Hero vista composition becomes both required game compositions:
  1. Tactical overhead command view.
  2. Third-person Sherman tank view.

## Reference Targets

The reference images in `references/` include at least these target categories.

### Tactical Overhead Reference

The tactical camera screenshot must clearly resemble the overhead command reference:

- Overhead/isometric tactical view.
- Normandy-style village crossroads.
- Capture objective in the village center.
- Friendly Sherman tanks, rifle squads, and scout teams.
- Enemy markers around roads, buildings, and defensive positions.
- Unit roster on the left.
- Objective panel top-left.
- Capture/contested progress indicator.
- Command buttons.
- Selected-unit panel.
- Time controls.
- Minimap bottom-right.
- Smoke, fire, damage, rubble, hedgerows, roads, and village detail.
- Tactical readability at a glance.

### Third-Person Tank Reference

The third-person screenshot must clearly resemble the tank-view reference:

- Camera behind a Sherman-style tank.
- Normandy village road.
- Church/steeple visible.
- Stone houses, walls, hedgerows, fields, smoke columns, dust, and damage.
- Objective box top-left.
- Compass top-center.
- Crosshair/reticle.
- Circular minimap bottom-left.
- Tank HUD bottom-center with health, reload, and speed.
- Return-to-command button.
- Active combat moment with enemy marker, muzzle flash, projectile, impact, or explosion.
- Heavy vehicle feel.

### LAAS Benchmark References

The LAAS project reference images in `references/` define the required quality bar for:

- Geometry density.
- Procedural material richness.
- Lighting quality.
- Shadow readability.
- Atmospheric depth.
- Terrain detail.
- No empty foreground.
- No flat-looking surfaces.
- No cheap placeholder composition.
- Verification discipline.

Do not copy LAAS forest content literally unless it naturally fits the WWII environment. Translate the quality bar into the Normandy setting.

## Game Modes

### Mode 1 — Tactical Command Mode

Implement an overhead/isometric RTS-style command view.

Required camera controls:

- Pan.
- Rotate.
- Zoom.
- Edge pan or WASD pan.
- Mouse wheel zoom.
- Q/E rotate.
- Middle mouse or right-drag camera control.
- Camera bookmarks or control groups with number keys.

Required unit controls:

- Left click select.
- Shift-click add/remove selection.
- Drag rectangle multi-select.
- Right click move.
- Attack move.
- Attack target.
- Attack ground.
- Stop.
- Hold position.
- Direct-control selected tank.
- Multi-unit command handling.
- Unit path/intent visualization.

Required tactical UI:

- Objective panel top-left.
- Unit roster left side.
- Selected-unit detail panel.
- Command button panel.
- Time controls: pause, slow, normal, fast.
- Capture progress panel.
- Tactical icons above units.
- Enemy markers only for spotted enemies.
- Health bars.
- Reload indicators.
- Suppression indicators for infantry.
- Minimap bottom-right.
- Debug HUD toggle.

### Mode 2 — Third-Person Tank Mode

Implement direct over-the-shoulder control of a Sherman tank.

Required controls:

- WASD drive.
- Mouse aim turret/cannon.
- Left mouse fire main cannon.
- Machine gun fire.
- Manual/automatic reload state.
- Camera distance toggle.
- Tab return to tactical command.

Required vehicle feel:

- Heavy acceleration.
- Braking.
- Turn rate.
- Track-based turning behavior.
- Turret traverse.
- Cannon elevation.
- Recoil.
- Dust.
- Tracks.
- Hull/turret separation.
- Projectile travel.
- Hit feedback.
- Damage feedback.

Required tank UI:

- Objective box top-left.
- Compass top-center.
- Crosshair center.
- Tank health bottom-center.
- Reload status bottom-center.
- Speed bottom-center.
- Circular minimap bottom-left.
- Return-to-command button.
- Damage direction indicator.
- Target marker when aiming at spotted enemy.

### Mode Switching

Required behavior:

- Tab toggles direct-control mode for the selected controllable tank.
- If no tank is selected, Tab selects the nearest living Sherman.
- Tactical AI/autopilot resumes for the tank when leaving direct-control mode.
- Other friendly units continue obeying tactical commands while one tank is directly controlled.
- The objective, AI, projectiles, damage, minimap, and mission state continue running in both modes.

## Mission

Mission name:

```text
Capture the Crossroads
```

### Player Force

Required starting force:

- 3 Sherman M4A1 medium tanks.
- 3 rifle squads.
- 2 scout teams.

### Enemy Force

Required enemy defenders:

- Infantry in buildings.
- Infantry behind walls.
- At least 1 anti-tank gun covering a road.
- At least 2 machine-gun teams or MG nests.
- At least 1 German armored vehicle or assault gun.
- Enemy reinforcements after capture progress reaches 50%.

### Objectives

Required objective chain:

1. Advance into the village.
2. Neutralize enemy defenders.
3. Enter the village center.
4. Capture the central crossroads.
5. Hold the capture zone.
6. Win when the capture bar completes and no enemy unit contests the zone.

### Loss Conditions

Required loss states:

- All player tanks destroyed and all infantry/scout squads eliminated.
- Mission timer expires on Hard difficulty.
- Player abandons or restarts from menu.

### Capture Mechanics

Required capture states:

- Neutral.
- Capturing.
- Contested.
- Securing.
- Secured.
- Enemy Recapturing.

Required rules:

- Capture zone around the central crossroads.
- Progress increases when player units are inside and no enemies contest.
- Progress slows when only scouts are present.
- Progress increases faster with combined arms.
- Zone becomes contested when both sides have living units inside.
- Progress decays slowly if only enemies are inside.
- Enemy reinforcements trigger at 50% player capture progress.
- Win triggers only after secured state and no enemy unit contests.

## Gameplay Systems

### Units

Implement these real unit types.

#### Sherman M4A1

Required:

- Recognizable procedural Sherman M4A1 silhouette.
- Rounded cast hull/turret impression.
- Main cannon.
- Coaxial/bow MG representation.
- Tracks.
- Road wheels.
- Turret rotation.
- Hull movement.
- Health.
- Armor facing.
- Reload.
- Range.
- Projectile velocity.
- Target acquisition.
- Line-of-sight.
- Movement/pathing.
- Wreck state.
- Fire/smoke destroyed state.

#### German Armor

Required:

- Distinct silhouette from Sherman.
- Darker/gray/ambush tone.
- Cannon.
- Turret or casemate behavior depending on vehicle.
- Health.
- Armor facing.
- AI target selection.
- Wreck state.

#### Rifle Squads

Required:

- Multiple soldier representations per squad.
- Squad health.
- Formation movement.
- Cover seeking.
- Suppression state.
- Rifle fire.
- Grenade/close HE behavior when near cover/buildings.
- Death/downed states.
- Tactical icon.
- HUD state binding.

#### Scout Teams

Required:

- Smaller team size.
- Larger sight radius.
- Faster movement.
- Lower combat strength.
- Better enemy spotting.
- Tactical icon.
- Capture contribution.

#### Anti-Tank Gun

Required:

- Fixed or limited traverse.
- High damage against armor.
- Crew representation.
- Concealed/covered defensive placement.
- Vulnerable to infantry and flanking.
- Target prioritization against tanks.

#### Machine-Gun Team

Required:

- Suppression against infantry.
- Limited anti-armor effect.
- Arc/position logic.
- Defensive placement behind cover or in buildings.
- Muzzle flash and tracer effect.

### Combat

Required damage and combat systems:

- Projectile simulation for tank shells.
- Projectile simulation or ray/burst simulation for small arms.
- Hit detection against vehicles, infantry, buildings, terrain, walls, and hedgerows.
- Armor-facing modifier: front, side, rear, top.
- Penetration and ricochet logic based on angle and armor class.
- HE blast radius against infantry and light objects.
- Machine-gun suppression.
- Rifle damage.
- Vehicle critical states:
  - mobility damaged
  - turret damaged
  - burning
  - destroyed
- Destroyed vehicles remain as wrecks and obstacles.
- Shell impacts create decals/craters.
- Explosions create light flash, smoke, debris, scorch marks, and sound.

### Cover and Suppression

Required:

- Walls provide cover.
- Hedgerows provide cover and block/limit sight.
- Buildings provide cover.
- Rubble provides cover.
- Craters provide partial cover.
- Infantry seeks nearby cover when under fire.
- Suppression reduces accuracy and movement.
- MG fire creates suppression zones.
- Cover affects hit chance and damage.

### Line of Sight and Fog of War

Required:

- Units need visibility to engage.
- Buildings block sight.
- Hedgerows block or reduce sight.
- Walls block or reduce sight depending height.
- Smoke reduces sight.
- Terrain height affects sight.
- Tactical mode shows enemy markers only for spotted enemies.
- Minimap shows spotted enemies, not all hidden units.
- Scouts improve spotting.

### AI

Required enemy behavior:

- Defenders occupy logical positions.
- AT gun prioritizes tanks.
- MG teams prioritize exposed infantry.
- Infantry seeks cover.
- Enemy infantry falls back or shifts positions when flanked.
- Enemy armor engages tanks.
- Enemy armor repositions if flanked.
- Reinforcements enter after 50% capture progress.
- AI uses line-of-sight/sensor logic and is not omniscient.
- Difficulty changes reaction time, accuracy, reinforcement timing, and damage tuning.

Required friendly behavior:

- Units obey player commands.
- Units avoid obviously suicidal paths when possible.
- Infantry uses cover along the route.
- Tanks avoid impassable obstacles.
- Units continue fighting while in tactical and third-person mode.

### Pathfinding

Required:

- Deterministic navigation.
- Tanks avoid buildings, large walls, impassable hedgerows, destroyed vehicles, and other tanks.
- Infantry can use narrower gaps.
- Movement commands produce visible paths or intent markers.
- Vehicles prefer roads when practical.
- Vehicles can leave roads.
- Infantry and vehicles use different navigation costs.
- Spatial partitioning/collision proxies for performance.

### World Interaction

Required:

- Shell impacts create craters/decals.
- Buildings have intact, damaged, and destroyed visual states.
- Stone walls can be damaged or partially broken.
- Hedgerows block vehicles unless a gap exists or damage opens a breach.
- Smoke affects visibility.
- Burning vehicles create persistent smoke/fire.
- Wrecks affect navigation and line-of-sight.

## Procedural World

Generate the Normandy world deterministically from seed.

Required world size:

- Playable area at least 1.5 km × 1.5 km.
- Visible surrounding countryside at least 4 km horizon composition using terrain shells, impostors, or far detail.

Required environment:

- Central village crossroads.
- Church with steeple.
- Stone houses.
- Brick/plaster houses.
- Barns.
- Sheds.
- Fences.
- Road signs.
- Telephone poles.
- Rubble piles.
- Carts.
- Crates.
- Barrels.
- Bocage hedgerows.
- Crop fields.
- Dirt roads.
- Muddy tracks.
- Low stone walls.
- Garden plots.
- Orchards.
- Hay fields.
- Shell craters.
- Broken walls.
- Scorched roofs.
- Smoke columns.
- Fires.
- Dust.
- Embers.

Required minimum content:

- At least 30 buildings/structures.
- At least 150 wall/fence/hedgerow segments.
- At least 3 crop/field types.
- At least 3 road materials/states:
  - paved/cobblestone
  - dirt
  - muddy/gravel
- At least 6 environmental zones:
  1. Village center.
  2. Residential stone-house cluster.
  3. Church/square.
  4. Bocage/hedgerow lanes.
  5. Fields/orchards.
  6. War-damaged approach road.
  7. Optional lowland/ditch/stream area if the seed layout supports it.

Required generation rules:

- Deterministic PRNG.
- Road network creates tactical lanes.
- Buildings align with roads and crossroads.
- Cover placement supports gameplay.
- Enemy positions are selected from defensible tactical locations.
- Player spawn has multiple approach routes.
- No obvious repeated cloned patterns.
- Dense detail near both tactical and third-person cameras.

## Visual Art Direction

The world must look like a high-end WWII tactical game, not a browser toy.

### Lighting

Required:

- Golden late-afternoon default.
- Warm sunlight.
- Cool readable shadows.
- Directional sun.
- Sky/atmosphere.
- No black ambient shadows.
- Contact shadows under vehicles, infantry, walls, debris, grass, and buildings.
- Ambient occlusion.
- Filmic tone mapping.
- Controlled contrast.
- Restrained saturation.
- Stable temporal image.

### Geometry Density

Required:

- Detail lives in geometry and silhouette, not flat textures.
- Roads have gravel, stones, tire ruts, mud patches, puddles, shell craters, dust, and debris.
- Fields have actual blade/row geometry or dense instanced cards/mesh blades.
- Hedgerows have layered geometry.
- Stone walls are assembled from varied stone blocks or procedural stones.
- Buildings have depth:
  - window frames
  - roof tiles
  - chimneys
  - shutters
  - damaged facades
  - doors
  - rubble
- Near-camera ground within 10 meters must not be a bare flat texture.

### Rendering Systems

Required:

- WebGPU renderer.
- Physical-ish lighting.
- Directional sun and sky/atmosphere.
- High-quality shadows.
- Contact shadows.
- Ambient occlusion.
- Volumetric smoke columns.
- Dust particles from tanks.
- Muzzle flashes.
- Shell tracers/projectiles.
- Explosions with light flash, smoke, debris, scorch mark.
- Tank tracks/dust trails.
- Procedural PBR-like materials.
- Filmic tone mapping/color grade.
- Temporal stability solution.
- LOD/impostor strategy.
- Dithered or stable LOD transitions.
- No visible near-camera pop.

Required procedural materials:

- Olive drab tank paint.
- Worn metal.
- Mud.
- Stone.
- Brick.
- Plaster.
- Roof tile.
- Road gravel.
- Crop field.
- Grass.
- Hedgerow foliage.
- Smoke.
- Fire.
- Scorch marks.
- Dust.

## Audio

Audio is required.

Implement browser-safe procedural or generated audio for:

- Tank engine loop.
- Tank track movement.
- Cannon fire.
- Machine-gun fire.
- Rifle fire.
- Explosion.
- Shell impact.
- Infantry hit/suppression cue.
- UI clicks.
- Capture progress cue.
- Capture contested cue.
- Mission success cue.
- Mission failure cue.
- Ambient wind.
- Distant battlefield rumble.

Audio hooks alone are not sufficient.

## Menus and Settings

Required menu:

- Start mission.
- Restart mission.
- Difficulty:
  - Easy
  - Normal
  - Hard
- Graphics preset:
  - Low
  - High
  - Ultra
- Seed input.
- Controls/help screen.
- Resume.
- Quit to menu.

Required URL parameters:

```text
?seed=N
?preset=low|high|ultra
?mission=crossroads
?mode=tactical|tank
?hud=1
?cam=x,y,z,yaw,pitch,fov
?debug=1
?freeze=1
```

## Controls

### Global

Required:

- Tab: switch tactical/direct tank mode.
- Esc: menu.
- F3: debug HUD.
- P: print current camera pose and seed.
- 1-9: select control groups or camera bookmarks.
- Space: pause/unpause in tactical mode.

### Tactical

Required:

- Left click: select.
- Shift left click: add/remove selection.
- Drag left mouse: selection rectangle.
- Right click: move selected units.
- A: attack move.
- G: attack target / attack ground.
- S: stop.
- H: hold position.
- Mouse wheel: zoom.
- Middle mouse/right-drag: rotate/pan.
- Q/E: rotate camera.
- WASD/edge pan: pan camera.

### Direct Tank

Required:

- WASD: drive.
- Mouse: aim turret/cannon.
- Left click: fire main gun.
- Right click or key: fire MG.
- R: reload if manual reload state is used.
- Shift: throttle/gear behavior.
- C: change camera distance/shoulder.
- Tab: return to command.

## Project Structure

Use a real modular architecture.

Suggested structure:

```text
src/
  main.ts
  app/
    App.ts
    Boot.ts
    Diagnostics.ts
    Config.ts
  core/
    Time.ts
    Input.ts
    EventBus.ts
    Math.ts
    Random.ts
    ECS.ts
  render/
    Renderer.ts
    CameraRig.ts
    TacticalCamera.ts
    TankCamera.ts
    Lighting.ts
    Shadows.ts
    Post.ts
    Materials.ts
    DebugHud.ts
  world/
    World.ts
    Terrain.ts
    VillageGenerator.ts
    RoadGenerator.ts
    BuildingGenerator.ts
    CoverGenerator.ts
    FieldGenerator.ts
    Scatter.ts
    MinimapData.ts
  assets/
    TankGenerator.ts
    InfantryGenerator.ts
    BuildingMeshes.ts
    FoliageGenerator.ts
    DebrisGenerator.ts
    MaterialSynthesis.ts
  game/
    GameState.ts
    Mission.ts
    ObjectiveCapture.ts
    Unit.ts
    Vehicle.ts
    InfantrySquad.ts
    Weapon.ts
    Damage.ts
    Projectile.ts
    Suppression.ts
    LineOfSight.ts
    FogOfWar.ts
    Commands.ts
    Selection.ts
    DirectControl.ts
  ai/
    EnemyAI.ts
    SquadAI.ts
    VehicleAI.ts
    Targeting.ts
    TacticalReasoning.ts
  nav/
    NavGrid.ts
    Pathfinding.ts
    Steering.ts
    Formation.ts
  ui/
    Hud.ts
    TacticalHud.ts
    TankHud.ts
    Minimap.ts
    UnitRoster.ts
    CommandPanel.ts
    Menu.ts
    styles.css
  effects/
    Smoke.ts
    Fire.ts
    Dust.ts
    Explosion.ts
    MuzzleFlash.ts
    Decals.ts
    Tracks.ts
  tools/
    ShotHarness.ts
    ReferenceCompare.ts
    StatsCapture.ts

tools/
  shoot.ts
  compare.ts
  battery.ts

docs/
  STATUS.md
  DELTA.md
  BLOCKERS.md
  CONTROLS.md
  GAMEPLAY.md
  TECHNICAL_NOTES.md

references/
  user and LAAS reference images
```

Do not collapse the project into one giant file.

## Verification

Required scripts:

```text
npm run dev
npm run typecheck
npm run build
npm run shoot
npm run compare
npm run battery
```

The Playwright battery must:

1. Launch the game.
2. Verify WebGPU diagnostics.
3. Load deterministic seed.
4. Capture tactical view screenshot.
5. Capture third-person tank screenshot.
6. Capture HUD/debug screenshot.
7. Run mission simulation for at least 60 seconds.
8. Confirm no runtime exceptions.
9. Confirm no console errors.
10. Confirm no unhandled promise rejections.
11. Confirm objective capture state changes.
12. Confirm at least one enemy engages.
13. Confirm at least one player unit fires.
14. Confirm at least one enemy unit fires.
15. Confirm projectiles can hit/damage units.
16. Confirm a unit can be destroyed.
17. Confirm destroyed vehicle remains as wreck.
18. Confirm minimap renders terrain, player units, spotted enemies, objective, and camera direction.
19. Confirm graphics preset parameter works.
20. Confirm debug HUD reports real counters.
21. Confirm player can win.
22. Confirm player can lose.

## Reference Delta Loop

Every phase must run this loop:

1. Render tactical screenshot.
2. Render third-person screenshot.
3. Generate side-by-side comparison images against relevant files in `references/`.
4. Write top 10 visual/gameplay deltas into `docs/DELTA.md`.
5. Fix the top 3 deltas.
6. Re-render.
7. Update `docs/DELTA.md` with what changed.
8. Only then close the phase.

Required comparison outputs:

```text
shots/compare/tactical_vs_references.png
shots/compare/tank_vs_references.png
shots/compare/laas_quality_vs_current.png
```

The comparison does not need to be perfect pixel matching. It must evaluate composition, visual density, UI presence, lighting, procedural detail, and gameplay evidence.

## Performance

Performance is not a reason to remove required systems.

If visual density causes poor performance, optimize.

Required optimization systems:

- Instancing.
- Batching.
- LODs.
- Impostors.
- Spatial partitioning.
- Frustum culling.
- Distance culling.
- Simplified collision proxies.
- Fixed AI tick budgets.
- Scalable shadow quality.
- Scalable particle density.
- Scalable foliage/detail density.
- Deterministic quality presets.

Low preset may reduce density, shadow resolution, particle count, and draw distance.

Low preset may not remove core gameplay systems.

High and Ultra must preserve the intended visual target.

Target:

- High preset should target 60 FPS on RTX-3060-class desktop at 1080p/1440p.
- Ultra should prioritize quality but remain playable on stronger hardware.
- Low should remain playable on weaker WebGPU-capable desktop hardware.

## Phase Plan

Work autonomously.

Do not wait for approval between phases.

Close each phase only after:

```text
build
run
screenshot
verification
DELTA.md update
top-three visual fixes
re-shoot
BLOCKERS.md update
```

### Phase 0 — Scaffold

Required:

- Vite/TypeScript/WebGPU project.
- WebGPU fail-loud diagnostics.
- Renderer.
- Input system.
- Time system.
- Tactical camera stub that actually renders.
- Tank camera stub that actually renders.
- Basic HUD shell.
- Playwright shot harness.
- Reference images discovered from `references/`.
- Comparison tooling scaffold.
- `STATUS.md`.
- `DELTA.md`.
- `BLOCKERS.md`.

Phase 0 cannot close unless the app launches, WebGPU initializes, and screenshots are captured.

### Phase 1 — World/Village

Required:

- Deterministic terrain.
- Normandy village generator.
- Road network.
- Central crossroads.
- Church.
- Stone houses.
- Brick/plaster houses.
- Fields.
- Hedgerows.
- Stone walls.
- Rubble.
- Craters.
- War-damaged approach routes.
- Minimap terrain data.
- Lighting and shadows.

Phase 1 cannot close unless the tactical overhead screenshot already reads as a Normandy village crossroads.

### Phase 2 — Units/Assets

Required:

- Procedural Sherman.
- Procedural German armor.
- Procedural infantry squads.
- Procedural scout teams.
- Procedural AT gun.
- Procedural MG team.
- Unit roster.
- Selection.
- Multi-selection.
- Commands.
- Movement/pathfinding.
- Tactical icons.
- Health state.

Phase 2 cannot close with cube tanks, cube buildings, fake unit markers only, or nonfunctional commands.

### Phase 3 — Combat

Required:

- Tank cannon.
- MG fire.
- Rifle fire.
- Projectile simulation.
- Hit detection.
- Armor facing.
- Penetration/ricochet.
- HE blast.
- Suppression.
- Cover.
- Explosions.
- Smoke.
- Muzzle flashes.
- Decals.
- Craters.
- Wreck states.
- Sound effects.

Phase 3 cannot close unless real damage and destruction are demonstrated.

### Phase 4 — Mission/AI

Required:

- Capture zone.
- Capture states.
- Win condition.
- Loss condition.
- Enemy defensive AI.
- Friendly command AI.
- Targeting.
- Cover behavior.
- Line-of-sight.
- Fog-of-war/spotted enemies.
- Reinforcements at 50% capture.
- Tactical pause/speed controls.

Phase 4 cannot close unless the mission can be won and lost.

### Phase 5 — Third-Person Tank Mode

Required:

- Behind-tank camera.
- Direct tank driving.
- Turret/cannon aiming.
- Cannon firing.
- MG firing.
- Reload state.
- Recoil.
- Tank HUD.
- Compass.
- Circular minimap.
- Return-to-command flow.
- Combat while in direct tank mode.
- Tactical AI continues for other units.

Phase 5 cannot close unless the tank-view screenshot clearly resembles the third-person reference and is playable.

### Phase 6 — Visual Density and Polish

Required:

- Better procedural materials.
- Dense near-camera ground detail.
- Road detail.
- Wall detail.
- Hedgerow detail.
- Building depth/detail.
- War damage.
- Smoke columns.
- Dust/tracks.
- Volumetric effects.
- Contact shadows/AO/post.
- Temporal stability.
- UI polish.
- Audio polish.
- Reference delta top fixes.

Phase 6 cannot close if the world still looks sparse, flat, toy-like, or placeholder-driven.

### Phase 7 — Performance, Verification, Release

Required:

- Graphics presets.
- Debug HUD complete.
- Battery script complete.
- Compare script complete.
- README complete.
- Controls doc complete.
- Gameplay doc complete.
- Technical notes complete.
- Zero open blockers.
- Final screenshots.
- Final successful command run.

Phase 7 cannot close unless all final acceptance commands pass.

## Final Acceptance Gate

The project is not complete until all commands pass:

```text
npm install
npm run typecheck
npm run build
npm run dev
npm run shoot
npm run compare
npm run battery
```

The final battery must prove:

- WebGPU initialized.
- Deterministic seed loads.
- Tactical screenshot generated.
- Third-person screenshot generated.
- HUD screenshot generated.
- Objective capture changes state.
- Enemy AI engages.
- Player unit fires.
- Enemy unit fires.
- Projectile hits.
- Damage changes health.
- Unit can be destroyed.
- Wreck remains.
- Minimap displays terrain, objective, player units, spotted enemies, and camera direction.
- Player can win.
- Player can lose.
- No runtime exceptions.
- No console errors.
- No unhandled promise rejections.
- Debug HUD reports real counters.

## Final Delivery

Final delivery must include:

1. Complete project files.
2. Working run instructions.
3. Controls.
4. Tactical screenshot.
5. Third-person screenshot.
6. Contested capture screenshot.
7. Mission won screenshot.
8. Mission lost screenshot.
9. Debug HUD screenshot.
10. Final `README.md`.
11. Final `docs/STATUS.md`.
12. Final `docs/DELTA.md`.
13. Final `docs/BLOCKERS.md` showing zero open blockers.

If there are open blockers, do not present the project as complete.

Continue working until zero blockers remain.

## Start Now

Start by inspecting the project workspace, the `references/` folder, and the LAAS benchmark repository.

Then create the complete scaffold and proceed through the phases autonomously.

Do not stop at a prototype.
Do not stop at a demo.
Do not stop until the project is a complete playable game that passes the final acceptance gate.
