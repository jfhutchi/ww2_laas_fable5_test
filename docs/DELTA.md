# Reference Delta Ledger

Per-phase side-by-side comparison against `references/` — top 10 visual/gameplay deltas ranked by impact, top 3 fixed before phase close.

Reference set:
- `references/overhead.png` — tactical command view target (CoH-class Normandy crossroads, full tactical UI).
- `references/third_person.png` — third-person Sherman view target (village road, church, combat moment, tank HUD).
- `references/scene1.png`, `scene2.png`, `scene3.png` — LAAS v2 quality bar (geometry density, light transport, atmosphere).

---

## Codex rebuild — independent review hardening (closed)

The isolated `codex/operation-crossroads-rebuild` branch received a read-only independent review after its menu, HUD, controls, hero assets, village facades, staging, atmosphere, effects, and cinematography passes. The review found a delayed input-ownership defect hidden behind an initially green test: right-drag motion could remain queued and rotate the camera when middle orbit was acquired later. New red browser proof reproduced `yaw -3.09 → -3.22`; the input channel now drains every tactical frame and resets on ownership acquisition. WASD uses rendered `curYaw`, so forward stays aligned to screen-top during damping.

Direction-aware chase-camera collision now lets a target leave facade padding but blocks travel inward through axis-aligned or rotated buildings, including pitched roof volume. Damaged-church breach rafters receive the same 90° transform as nave tiles; a geometry-level browser assertion guards their attachment. Release tooling now rejects empty battery filters and incomplete comparison sets, checks runtime diagnostics after every scenario, and requires contested/won/lost states before final images are named. Fresh proof: install clean, tests/typecheck/build clean, canonical captures and all three comparisons produced, strengthened battery **19/19** in 184 s, six-state final suite clean, ~118–139 fps during canonical high-preset captures.

The final ranked visual loop replaced stepped black roof cutouts with deterministic independently ragged tile-course edges and properly sloped warm-charred rafters/cross-battens. Ambient building fires now warm-start vertically stratified smoke instead of leaving the opening battlefield sterile for several seconds; the browser requires at least 60 live ambient particles at capture time. Canonical tank capture moved from the empty spawn field onto the same real village road as the delivery hero frame through one shared fail-loud staging helper. `shoot.ts` now rejects page/console/in-game errors and cleans up in `finally`. Exact post-polish proof: tests/typecheck/build clean, canonical shoot + all three comparisons clean at ~118–124 fps, full battery **19/19** in 188 s, and all six asserted final states regenerated.

Final release audit found that the legacy `worldHash` advertised “layout entities + terrain” while omitting props, building damage, roads, fields, smoke, and tactical anchors. It is now one pure complete-content digest; regressions mutate a single prop and damage state to prove sensitivity, and the real WebGPU deterministic-seed check still passes same-seed equality/cross-seed divergence. The branch-wide 48-file diff is whitespace-clean, contains no `as any`/suppression/TODO markers, all texture sources remain tracked and documented as CC0, and `main` remains clean at `9bb3aec`.

---

## Post-release iteration 8 — French town fabric: density, rows, architecture (closed)

User feedback: the town should read like real French towns — much denser placement, continuous building fabric, richer building styles. Verified: typecheck/build clean, battery **15/15** twice (once for the layout, once after review fixes — pathfinding, capture-and-win and combat all survive the walled streets), ~115–125 fps. Buildings 40 → **107** (65 row members, 38 three-story, 9 shopfronts); worldHash changed as expected (layout is world content; determinism is same-seed reproducibility, which the battery re-verified).

1. **Street-front rowhouse fabric** (Layout.ts): contiguous 2–3-story runs wall BOTH sides of all four arms from the crossroads out to ~118 m — party-wall butted (0.14 m seam), stepped rooflines from per-house height jitter, alley gaps every 3–7 houses (≥4.5 m so the 2.5 m nav grid keeps infantry routes), facades 1.2–2.2 m off the road edge, taller toward the square. Placement uses a new exact SAT rotated-rect test (the legacy circle test can't express legitimate adjacency) with all four corners road-clearance checked; the old core frontage loop became a detached farm belt at 124–185 m. Row members skip the per-house garden-wall boxes; `edgeAnchor` walks its standoff outward until the spot clears every footprint, so defenders can't spawn inside the next house of a run.
2. **French architecture** (BuildingMeshes.ts): `floors: 3` with string courses at every floor line, ground-floor **shopfronts** near the square (wide display pane + tucked door + painted fascia board), gabled roof **dormers**, party-wall rules (no windows/quoins/roof-tile cantilever on attached sides, chimney stacks moved onto the shared wall), per-floor gable-end windows with a 30% blind-pignon chance, and a widened render palette (pale ochre, warm grey — inside the brick-mask/colombage vertex-color contracts) plus oxblood/chasse-green shutters.
3. **Review pass paid off in buried geometry**: a 4-lens/19-finding adversarial workflow + hand verification found the new string courses and fascia sat INSIDE the wall piers (exterior plane is D/2, not D/2−t/2+ε) — and the same arithmetic showed the pre-existing colombage timbers had been entombed 11 cm deep since they were written. All three now sit proud of the facade; Norman half-timber is actually visible for the first time. Also fixed: dormer cap slabs peaked (Λ) instead of valleyed, dormers suppressed over street-slope damage holes.
4. Known-good gameplay interactions: MG/PaK/infantry anchors favor the new street-front houses (first-12 selection), ruins + fire smoke land inside the rows via the existing near-center damage boost, and the reinforcement/counter-attack scripting is untouched.

---

## Post-release iteration 7 — vehicles, infantry, photo leaf-card foliage (closed)

User feedback after iteration 6: "like what you did with the roads and textures — now do the same to the tanks and army guys; the trees look way too fake." Verified end-to-end on RTX: typecheck/build clean, shoot/compare regenerated, battery **15/15**, ~115–125 fps @1080p high, worldHash untouched, triangles DOWN 20.4M → 15.6M (cards are far lighter than icosphere canopies). Repo textures 32 MB total. Adversarially reviewed by a 15-agent workflow before commit (three confirmed findings, all fixed — see below).

1. **Trees/hedges/shrubs rebuilt as photo leaf-card canopies** — the "way too fake" lollipop read was solid displaced-icosphere blobs. Every canopy path (FoliageGenerator `makeBlob`, BarrierMeshes hedge crowns, GroundCover shrubs) now scatters alpha-tested card quads over the same ellipsoid envelopes: per-species CC0 LeafSet atlases (oak 016 / poplar 004 / apple 023 / bush+hedge 014), shell normals so clusters still light as soft volumes, per-card atlas mirroring, baked value shading + flex, existing wind untouched. LeafSet `_Color` backgrounds are pre-filled with the mean leaf colour (sharp) so alpha edges never fringe white and distant mips *solidify* instead of thinning (plus opacity ×1.5 boost against mip-alpha erosion).
2. **Tank photo-PBR** ('armor'/'tracks' kinds): Metal005 pitted cast steel on hull/turret, Metal038 + procedural grouser bars on tracks — sampled in **raw-attribute local space** so paint cannot swim while driving, relief via the finite-difference height path through `transformNormalToView` (parent group rotations included). Local-Y dust/mud gradient with per-material height calibration (hull heavy, turret skirt light, tracks caked), dust also raises roughness. Hull-side stars moved flush onto the upper-hull plates.
3. **Infantry**: uniforms/kit on a coarse-weave Fabric066 'cloth' kind (raw-attribute space — `positionLocal` is instance-transformed and would swim on walking soldiers), plus deterministic per-slot instanceColor jitter seeded **before first render** (pipeline-compile trap) so squads stop reading as clone armies. Sandbags inherit the weave (burlap for free).
4. **Review findings fixed** (multi-agent adversarial pass): (a) HIGH — the WebGPU shadow pass derives cutout alpha from `colorNode.a`/map only, never `opacityNode`; leaf cutouts moved into a vec4 colorNode so canopies cast dappled (not full-quad) shadows; (b) MED — gun barrels sit at local y≈0 in their pivot Groups and took maximum dust; they now use a dust-free armor material; (c) LOW — hedge instance scale anisotropy (up to 3.8:1) smeared the leaf photos; spread tightened.
5. **Skipped, with reasons**: Polyhaven's CC0 model library has no European deciduous trees (inventory is pines/tropical/succulents — checked via API) and Sketchfab/Smithsonian downloads sit behind logins, so the glTF hero-tree/M4A1 stretch remains open; the card-canopy route delivered the realism jump without licensing risk.

---

## Post-release iteration 6 — CC0 photo-PBR texture pass (closed)

Bar: the procedural groundwork was done but every surface was still flat-shaded value noise — add real photo textures without losing the muted-olive grade or determinism. Verified on an RTX-class GPU: typecheck + build + shoot + compare clean, battery **15/15**, ~120 fps @1080p high (unchanged), worldHash untouched (render-only change). Repo +26 MB (11 ambientCG 1K-JPG sets × Color/Roughness/Displacement — see docs/ASSETS.md).

1. **Photo-texture layer in the shared material law** (`render/MaterialDetail.ts`): 11 CC0 ambientCG sets (two meadow grasses patch-blended, soil, gravel, paving setts, lime plaster, brick, layered limestone, terracotta + slate roof tiles, bark) sampled in world space — XZ-planar for ground kinds, |normalWorld|⁸ triplanar for walls/roofs/trunks; no UV unwrapping anywhere. Albedos are normalized to mean-1.0 LINEAR multipliers (per-channel reciprocals from offline stats) and partially desaturated, so the painted vertex palette and golden-hour grade still rule; the procedural macro/meso/micro bands stay on top and keep killing tiling. Surface classes inside merged meshes are recovered from the paint itself: brick-red vs plaster (r−g), terracotta vs slate (r−b), cobbled vs dirt road (r/b ratio **and** brightness — the damaged approach shares the paved hue and must stay broken dirt), crop/worn soil vs meadow. Norman facades get a render-coat mask: stone coursing shows only in flaked patches under lime render that sits ~2 mm proud.
2. **`bumpMap()` was a silent no-op — relief is now real.** three's BumpMapNode offsets UVs via a context that only TextureNodes consume, so the previous pure-expression procedural heights produced a zero gradient: none of the "bump relief" ever lit. Replaced with world-space finite differences of a meters-scaled total height field (procedural coursing/grooves/clods + photo Displacement maps) — 4 evaluations at ±3.5 mm offsets → 3D gradient → perturbed `normalWorld` → view space. Mortar recesses, tile lips, rock strata and road gravel now genuinely catch the low sun; no normal-map files are shipped at all.
3. **Roads staged by kind**: cart roads blend crumbly soil with patchy gravel wear, the paved arm + parvis + rond-point read as worn setts, and the shelled approach stays churned dirt (brightness-gated mask). Tree trunks moved from plank 'wood' to a new 'bark' kind.
4. **Deliberately skipped**: Poly Haven HDRI sky (a photographic sky was previously trialed and rejected as blurry, and the current procedural dome + cloud deck is an approved look — revisit only with a side-by-side win) and the glTF M4A1/hero-tree stretch goal (CC0 provenance/quality bar not met in-session; VehicleRig contract notes remain in TankGenerator).

Remaining texture-adjacent ledger: far-field annulus + distant silhouettes untextured (impostor atlas still the answer), infantry/props untouched by the photo layer, facade streak grime under eaves still wants a per-building local frame.

---

## Post-release iteration 5 — reference-similarity pass on a CPU-only rig (closed)

Bar restated by the user: get as close to `references/` as possible without artists/animators. Verified end-to-end on a GPU-less container (WebGPU over SwiftShader Vulkan, headed Chromium under Xvfb) — which surfaced real spec violations that desktop Dawn had been forgiving:

1. **Black frame root-caused and fixed** — the volumetric-cloud bake used `r16float` STORAGE 3D textures (illegal per WebGPU spec) and 3D textures at all hit an invalid-2D-view Dawn path on this stack (lazy zero-init AND writeTexture), dropping every command buffer that bound them; the shared half-res pass died and GTAO multiplied the frame to black. Rebuilt as CPU-baked (period-wrapped fbm3D/worley3D in `core/Noise.ts`) **2D slice atlases** with manual trilinear TSL sampling — spec-clean everywhere, deterministic, no compute dependency.
2. **Harness framing was fiction** — `?cam=` was parsed but `setPose` never called, and the rig's edge-pan drifted under the synthetic pointer: every "village crossroads" capture since the framing landed was actually the default pose ~150 m south (open wheat). Pose now applied + rig pinned under `freeze`; `getCameraPose`/`setCameraPose`/`debugScene` exposed on the test API; village camera retargeted to genuinely frame the plaza.
3. **Palette/material truthing vs the reference frames**: terrain + roads moved onto the shared macro/meso/micro detail law (they were the last flat-lit surfaces); meadow retuned to muted olive with sun-dried worn patches; grass strip on cart-road centerlines; weathered terracotta + slate-heavier roof mix; cast-armor detail material + darker olive drab on vehicles (plastic-shine gone); infantry rebuilt with pelvis/chest/belt/knee proportions (torso was a 0.34×0.42 m slab); saturation eased, exposure 0.98.
4. **Smoke actually tinted** — InstancedMesh pipelines compile against build-time attributes, so `setColorAt` after first render was ignored: every particle rendered stark white. instanceColor is now seeded pre-render; war-smoke columns are taller, longer-lived, lit mid-gray.
5. **Cloud deck restored** — the CPU value-noise fields are flatter than the GPU gradient noise they replaced; contrast-stretched base + weather so the cumulus band survives the coverage remap.
6. **Harness hardening for CPU-only containers**: SwiftShader launch recipes with a full swapchain smoke test (adapter-only probes accept broken headless configs), Xvfb fallback with stale-lock detection, screenshot/navigation timeouts sized for software rasterization, `--extra` URL-param passthrough in shoot.

---

## Post-release iteration 4 — LAAS parity ports (closed)

Bar restated by the user: as good or better than LAAS. Three parallel implementation agents ported from the LAAS source; orchestrated integration. Battery re-verified **15/15**; ~117 fps @1080p with the full chain.

1. **Raymarched volumetric clouds** (`render/VolumetricClouds.ts`): baked perlin-worley 64³ base + 32³ worley detail + 256² weather coverage (all compute-baked once, seeded); 24-step march with 2 sun taps, dual-lobe HG phase + powder + Beer, static spatial dither, early-out, premultiplied composite over the hazed image with scene-depth clipping; drift shares the seed/wind formula with the 2D cloud-shadow field so the deck and its shadows move together. LAAS's signature sky is now in.
2. **Fixed GTAO + shared half-res MRT pass** (`render/Gtao.ts`, `render/HalfResMrt.ts`): LAAS's two output-affecting GTAO fixes (same-texel rejection that stops far-grazing black crush on RTS vistas; NaN horizon clamp), normals from depth (normal MRT attachment dropped — smaller scene pass), joint-bilateral upsample with the wsum-gated fallback (no additive floor), sky ao=1. AO + cloud march share one half-res quad raster.
3. **Vegetation wind** (Pillar F): grass/wheat blades bend by local-height² with two-frequency Lissajous sway; hedgerow crowns breathe; structured-tree sway via per-vertex flex attribute (agent port). All vertex-stage positionNode — shadows sway for free.
4. **Hero trees** (`assets/FoliageGenerator.ts` rewrite): structured skeletons (trunk + primary/secondary branches + tip leaf clusters) replacing blob canopies, 3 archetypes × 4 species, flex attribute baked for wind.
5. **CSM attempt — parked with findings**: stock CSMShadowNode produced no usable cascade maps under the PostProcessing scene-pass pipeline (init-order trap documented: `_init` only fires while `camera===null`; cascades still empty-rendered). LAAS needed its custom `CsmCached` + near/far fixes for the same environment. Reverted to the proven 4096 single-map (the long golden shadows in every hero shot); full CsmCached port remains on the ledger.

---

## Post-release iteration 3 — surface textures + village-plan rework (closed)

User feedback: textures should approach the reference imagery; layout had walls/fences clipping roads and houses; the village should read like a real European settlement. Battery re-verified **15/15**.

1. **Macro–meso–micro material law** (`render/MaterialDetail.ts`): all world materials swapped to `MeshStandardNodeMaterial` with pure-expression TSL detail multipliers layered over the existing vertex colors (NodeMaterial multiplies colorNode × vertexColor × instanceColor natively — verified in the study). Three shared frequency bands (≈9 m / 1.4 m / 0.2 m) kill flat reads and tiling, plus per-class structure: **masonry stone coursing** with mortar-line shadows and per-stone value steps, **per-tile roof variation**, plank grain on wood, gravel speckle on roads, clod texture on hedgerow berms, leaf sparkle on foliage — and micro-driven roughness variance so highlights stop reading plastic. Applied to buildings, barriers, terrain, roads, and ground cover.
2. **Village plan rework** (`world/Layout.ts`): barriers are now emitted as short runs through `addBarrierRun`, which drops any piece crossing a road or clipping a building footprint (rotated-rect test) — walls end cleanly at obstacles instead of threading through houses; hedgerow field boundaries get the same building test. Civic ground added *before* housing so frontages address it: a **cobbled parvis** in front of the church (24 m paved plaza feeding the crossroads road) and a **town-square apron** at the junction itself. The well stands on the parvis; the churchyard wall keeps its road-facing gate.

Follow-ups if desired: plaza furniture (market stalls/benches), wall gate posts at run ends, streak grime under eaves (needs per-building local frame), normal-map bands on masonry.

---

## Post-release iteration 2 — LAAS render-stack port (closed)

Method: six parallel deep-read agents produced port plans from the LAAS benchmark source (file:line-referenced, THREE-NOTES-law-compliant); implemented in risk order with probe-driven debugging. Battery re-verified **15/15** after every stage.

Landed this iteration:
1. **TAA (TRAANode)** with analytic camera-reprojection velocity through the documented `velocityNode.load()` duck-type seam (stock velocity MRT is blind to displaced geometry); per-camera chains; history flush on tactical↔tank swap via `setSize(1,1)` restart; MSAA off on high/ultra (TAA replaces it and funds itself).
2. **Analytic aerial perspective** replacing linear fog on high/ultra: per-channel Rayleigh/Mie extinction (blue extinguishes first), altitude-dependent boundary haze, sun-side warm in-scatter lobe. Explicit per-chain camera uniforms synced at render time (post nodes see the quad camera — LAAS trap). Found en route: TSL boolean `select()` produced garbage — float-mask `mix` is the robust form.
3. **Drifting cloud shadows + crepuscular shafts**: deterministic CPU-baked coverage field (seeded fBm, mirrored wrap), sun-slant offset, wind drift from sim time (freeze-safe); ground darkening with an ambient floor plus in-scatter modulation at the ray midpoint — light shafts sweep the battlefield as banks drift.
4. **Golden-hour color script**: pre-tonemap grade — warm white balance, teal shadows / orange highlights split toning, saturation, mid-gray-pivot filmic contrast (LAAS t=19 keyframe softened ~25% for ACES).
5. **Image-based lighting**: procedural equirect sky radiance (warm sun lobe, blue zenith, luminous horizon, earthy ground bounce) as `scene.environment`; hemisphere reduced to a never-black floor.
6. **Density**: wheat/hay stalk geometry planted in rows matching the painted striping (~40k instances near the action), quoin corner blocks on masonry, Norman timber framing on plaster facades, denser road-verge grass.

Remaining ledger toward the full LAAS bar (plans in hand from the study agents): fixed-GTAO port (horizon-safe + bilateral upsample) with screen-space bounce, probe-GI field, full volumetric cloud march, CSM+PCSS+contact shadows, TSL macro-meso-micro material nodes, hierarchical wind. 

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
