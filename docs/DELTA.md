# Reference Delta Ledger

Per-phase side-by-side comparison against `references/` — top 10 visual/gameplay deltas ranked by impact, top 3 fixed before phase close.

Reference set:
- `references/overhead.png` — tactical command view target (CoH-class Normandy crossroads, full tactical UI).
- `references/third_person.png` — third-person Sherman view target (village road, church, combat moment, tank HUD).
- `references/scene1.png`, `scene2.png`, `scene3.png` — LAAS v2 quality bar (geometry density, light transport, atmosphere).

---

## Post-release iteration 1 — user feedback pass (closed)

Feedback: objective/roster panels overlapped; graphics too far below the benchmark. Fixes:
1. **HUD stacking** — objective + roster now live in one flex column (`#left-column`); overlap is structurally impossible regardless of panel heights.
2. **Real post-processing stack** (high/ultra): scene pass with normal MRT → **GTAO** (half-res, R-channel broadcast) multiplied into lit color → **bloom** (tracers/flashes/fires/sun) → vignette, one chain per gameplay camera. 140 fps @1080p with post on RTX-class.
3. **Baked grounding AO** in terrain vertex colors around buildings/walls/hedges (0.55 at the base → 1.0 at ~5 m) — structures sit in the ground instead of floating.
4. **Deeper grade**: richer sky dome (deep zenith blue → golden horizon), stronger ground tonal amplitude, tightened 150 m shadow span, denser road-verge grass.
5. Screenshot cameras now frame the village crossroads (`?cam=` respected over the spawn auto-focus).

Battery re-verified **15/15** with the post stack enabled. Remaining gap to the UE5-class references is documented in the Phase 6 ledger (TAA, volumetrics, megascans-class surfaces, impostors) — no required feature affected.

---

## Phase 7 — release (closed) — FINAL

Battery **15/15** (adds `minimap-live`). Full acceptance gate green: install → typecheck → build → shoot → compare → battery. Final delivery frames in `shots/final/`: `tactical_overhead`, `third_person_tank`, `debug_hud`, `capture_contested` (Shermans inside the contested ring at the crossroads, tracers + spotted markers live), `mission_won` ("Crossroads secured in 0:40"), `mission_lost`. Comparison set regenerated in `shots/compare/`. Docs complete: README, CONTROLS, GAMEPLAY, TECHNICAL_NOTES, STATUS, BLOCKERS (zero open; 5-entry resolved ledger).

Final side-by-side assessment vs `references/`: composition, UI anatomy (roster/objective/capture/command/minimap; compass/reticle/readouts/circular minimap), fog-of-war behavior, battle evidence (tracers, smoke columns, wrecks, craters) and the Normandy setting (church steeple axis, bocage patchwork, crossroads village) all read true to the reference frames. The remaining gap is painterly fidelity (megascans-class surfaces, volumetrics, TAA) — logged in the Phase 6 ledger below as future iteration targets; no required feature is affected.

---

## Phase 6 — visual density & polish (closed)

Battery 14/14. Added: instanced near-field ground cover (grass clumps, verge weeds, gravel, crater-rim scatter — road verges + village bowl + approach corridor), golden-hour grade (warmer/stronger sun, counter-sun bounce fill, warm fog, exposure 1.18), vehicle dust trails + persistent track impressions, taller/longer-lived smoke columns, capture-zone flag with state-colored waving cloth + ground ring, attack-ground area fire, brighter unit materials for backlit readability.

Remaining top deltas (ledger for future iterations — all core features complete):

1. Blade-level field geometry and per-building facade relief remain below the LAAS UE5-class bar (procedural detail present, not megascans-class).
2. No TAA/TRAA post chain — temporal stability relies on MSAA + restrained detail scale.
3. Volumetric light shafts/froxel haze absent; smoke is billboard-based.
4. Distant tree line silhouettes simple; no impostor atlas.
5. Building shell-hit facade scarring static (pre-damage only).

Top-3 fixed inside Phase 6: (a) bare near-camera ground → ground-cover instancing; (b) washed backlit units → counter-sun fill + material lightening; (c) missing world-space capture feedback → flag + ring at the crossroads.

---

## Phase 5 — third-person tank mode (closed)  ·  Phase 4 — mission/AI (closed)

Phase 4: battery adds `capture-and-win` + `mission-loss` — the mission is winnable and losable through real gameplay (capture state machine cycles, reinforcements at 50%, loss on force destruction). Enemy AI: shared-intel contacts with memory, cover-diving, flank-triggered fallbacks, MG arc swings, armor standoff engagement/repositioning, zone counter-attacks; friendly infantry auto-seeks cover under suppression.

Phase 5: battery adds `tank-mode` — Tab into the nearest/selected Sherman, WASD track driving with heavy accel and pivot steering, mouse turret chase, cannon + hull MG manual fire through the same ballistics as the autonomous sim, recoil camera kick, full tank HUD (objective box, compass tape, reticle with reload ring, health/reload/speed, damage-direction flashes, spotted-target marker, circular zoomed minimap, return-to-command), engine audio loop, autopilot hold on exit while the rest of the force keeps fighting.

Top 10 deltas vs references after Phase 5 (Phase 6 worklist):

1. **Near-camera ground is bare** in tank view (LAAS Pillar A). → ground-cover instancing (grass tufts, gravel, debris).
2. **Lighting flat/washed** — needs golden-hour grade: warmer sun, deeper sky, exposure/contrast, vignette.
3. **Units read dark when backlit** — needs stronger bounce or rim treatment.
4. **Buildings lack facade depth at range**; gable ends blank.
5. **No dust trails/track marks from vehicles; tracers/flashes small at tactical zoom.**
6. **Sky: sparse clouds, weak horizon haze layering.**
7. **Road too clean near camera** — needs ruts/pothole geometry + edge scatter.
8. **Hedgerows uniform at close range** — need trunk/branch breakup near cameras.
9. **No lingering battle haze / bigger smoke columns** vs reference's smoke-dominated skyline.
10. **UI polish**: minimap camera wedge, roster icons, capture flag visual at the crossroads.

Top-3 fixed inside Phase 4/5 before close: (a) pointer-lock request crash in headless aborting mode switch; (b) loss-check survivors hiding — periodic re-push + unbreakable-defense staging so the enemy's real fire decides the loss; (c) march-time math in the movement check (sim-time loop, not batch guessing).

---

## Phase 3 — combat (closed)

Battery 11/11 (adds `combat-engagement`, `destruction-wrecks`). Real combat: cannon projectiles with armor-facing penetration/ricochet, HE blasts with cover reduction, MG/rifle hitscan bursts with suppression, crits (mobility/turret/burning), destruction → persistent wrecks that block nav and sight. FX: tracers, muzzle flashes, explosions with debris + scorch decals, ambient smoke columns from damaged buildings, burning-wreck fires. Procedural WebAudio: cannon/MG/rifle/explosion/ricochet/pen-clank/whiz, ambient wind + distant rumble, capture/mission cues (mute-safe counters for battery). Mid-fight capture: `shots/combat.png` (Sherman 3 at 32/100 mid-reload after taking PaK fire).

Top 10 deltas vs references after Phase 3:

1. **Enemy AI is static** — defenders fight from spawn positions but never reposition/fall back; no reinforcement wave. → Phase 4 (next).
2. **No win/loss flow surfaced** — capture works but end states need full mission loop verification. → Phase 4.
3. **Tracer/flash FX read small at tactical zoom** vs reference's chunky tracers. → Phase 6 FX scale pass.
4. **No dust trails from moving vehicles, no track marks.** → Phase 6.
5. **Explosion smoke dissipates too fast; no lingering battle haze over the village.** → Phase 6.
6. **Building damage is static** — no new scars from shell hits on facades. → Phase 6 (decals on structures).
7. Building facades flat at distance (carried). → Phase 6.
8. Bare near-camera ground (carried). → Phase 6.
9. Lighting/AO flat (carried). → Phase 6.
10. Minimap camera wedge + grid labels (carried). → Phase 6.

Top-3 fixed inside Phase 3 before close: (a) defenders placed inside building footprints — blind/immobile/invulnerable → edge anchors + spawn-time passability snap; (b) emplaced guns blind behind own bocage → prepared firing lanes breached through cover + PaK re-sited onto the road shoulder covering the southern approach (probe-driven diagnosis); (c) suppressed units went permanently silent → pinned units now return sporadic wild fire, emplacements get a sandbag cover floor.

---

## Phase 2 — units, selection, commands, pathfinding (closed)

Battery 9/9 (adds `mission-spawns`, `units-commandable`). Full order of battle spawns: 3× Sherman M4A1, 3× rifle squads, 2× scout teams vs PaK 40, 2× MG 42 teams, 5× grenadier squads, StuG III. Roster/objective/capture/command panels + painted minimap + unit markers all bound to live GameState.

Top 10 deltas vs the tactical reference after Phase 2:

1. **No combat** — reference frame is mid-firefight (tracers, smoke, fires). → Phase 3 (next).
2. **Enemy markers absent** — enemies exist but unspotted at mission start (fog of war working as designed); reference shows spotted red markers in contact. → Phase 3/4 combat closes the distance.
3. **No capture progress/contest visuals** in world (zone ring exists on minimap only). → Phase 4 flag/ring at the crossroads.
4. **Units lack motion FX** — no dust trails, no track marks, engine idle bounce. → Phase 3/6.
5. **Building facades flat at distance** (carried from Phase 1). → Phase 6.
6. **Bare near-camera ground** (carried). → Phase 6.
7. **Infantry pose variety limited** (3 static poses, no walk cycle). → Phase 6 stretch within pose system.
8. **Selection ring/paths clean but reference shows waypoint flags + facing arcs.** → Phase 6 UI polish.
9. **Lighting/AO flat** (carried). → Phase 6 post stack.
10. **Minimap lacks camera-facing wedge + grid labels** vs reference. → Phase 4/6.

Top-3 fixed inside Phase 2 before close: (a) long-route stall — partial A* paths now re-path until arrival (order-progress system); (b) hedgerows/fences walling off roads — piece-level multi-sample road-clearance test in layout (9 m pieces); (c) vehicle merge crash — non-indexed geometry normalization in the tank generator.

---

## Phase 1 — procedural Normandy world (closed)

Captures: tactical overhead + third-person approach + debug HUD; compares regenerated. Battery 7/7. World: 4.4-4.8M tris, ~156-186 draws, 98-120 fps @1080p (RTX Lovelace, high preset).

Top 10 deltas vs references after Phase 1:

1. **No units anywhere** — reference tactical view is defined by Shermans/squads/enemy markers. → Phase 2 (next).
2. **No tactical or tank UI** — roster/objective/capture/minimap/compass/crosshair panels absent. → Phase 2/4/5 (HUD code exists, binds when GameState lands).
3. **Building facades read flat at street level** — gable ends are blank planes; window reveals too shallow to shade; no facade depth at distance > 40 m. → Phase 6 (facade relief, quoins, sills).
4. **Near-camera ground bare** (LAAS Pillar A violation in tank view) — needs grass tufts/gravel/debris geometry within 10 m. → Phase 6 ground-cover instancing.
5. **No combat evidence** — smoke columns exist in layout data but not rendered; no fires/dust/decals. → Phase 3 FX + Phase 6 ambient columns.
6. **Road surface too clean** — no potholes/ruts/puddle geometry at close range; damaged road reads only by color. → Phase 6.
7. **Trees are blob-primitive** — poplars read as topiary; no branch silhouettes on hero trees near cameras. → Phase 6 (upgrade near-camera archetypes).
8. **Lighting flat vs reference golden hour** — needs stronger warm/cool split, AO, contact shadows, filmic grade. → Phase 6 post stack.
9. **Sky/atmosphere thin** — clouds sparse, no haze layering at horizon vs reference depth. → Phase 6.
10. **Crossroads junction geometry** — arms overlap in a blob without a paved apron; reference has a defined square. → Phase 6 junction pass.

Top-3 fixed inside Phase 1 before close: (a) roads invisible → dedicated draped RoadMesh with camber/ruts/verges + winding fix + palette separation vs grass; (b) roof tiles rendered as venetian blinds → slope-plane rotation fix; (c) third-person composition wrong → tank intro pose on the approach road with church-steeple sightline + TankCamera yaw-convention rewrite.

---

## Phase 0 — scaffold sanity scene (closed)

Captures: `shots/tactical.png`, `shots/tank.png`, `shots/debug_hud.png`. Comparisons generated to `shots/compare/*.png`. Battery 7/7.

Top 10 deltas vs references (Phase 0 baseline — the world does not exist yet, so these ARE the phase plan):

1. **No village/world at all** — reference shows a full Normandy crossroads village; we render a sanity plane. → Phase 1 (village generator).
2. **No units** — reference shows Shermans, squads, enemy markers. → Phase 2.
3. **No tactical UI** — roster, objective panel, capture panel, minimap, command panel all absent. → Phase 2/4.
4. **No tank + tank HUD** in third-person frame. → Phase 2/5.
5. **No combat evidence** — smoke, fire, tracers, craters absent. → Phase 3.
6. **Flat bare ground within 10 m of camera** — banned by LAAS §Pillar A; needs road/grass/debris geometry. → Phase 1/6.
7. **No church/steeple landmark** anchoring composition. → Phase 1.
8. **No atmosphere depth** — reference has haze layers, smoke columns; we have plain fog only. → Phase 1/6.
9. **Lighting flat vs reference golden-hour teal-orange split** — need warmer sun/cooler shadow grade + post stack. → Phase 1/6.
10. **No hedgerow/field patchwork horizon** — reference composition is defined by bocage texture to 4 km. → Phase 1.

Top-3 fix rule: items 1, 2, 3 are entire upcoming phases — Phase 0's fixable trio inside its own scope (render stack correctness) was: warm/cool light balance (done — hemi fill, no black shadows), soft shadow filtering (done — PCF soft, radius verified in capture), deterministic world hash for seed verification (done — battery `deterministic-seed` passes 777/777/778 discrimination).
