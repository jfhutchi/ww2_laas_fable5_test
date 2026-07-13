# Technical Notes

## Stack & constraints

- **WebGPU only** (three.js 0.184 `WebGPURenderer`; backend asserted after init — a silent WebGL fallback throws). Fail-loud adapter diagnostics screen before renderer construction.
- **TypeScript strict** + `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`; zero `any` in `src/` and `tools/`.
- **Zero external assets** — every mesh, texture (canvas-painted minimap, radial FX sprites), and sound (WebAudio synthesis) is generated in code.
- **Determinism**: everything procedural derives from `?seed=N` via named `Rng` forks (`core/Random.ts`, splitmix32 + FNV hashing). The content hash covers roads, complete building state, barriers, fields, props, craters, smoke, zones, spawns, tactical anchors, and sampled terrain; pure regressions prove prop/damage mutations change it, while the WebGPU battery verifies same-seed reproducibility and cross-seed divergence.

## World generation pipeline

`Layout.ts` (pure function of seed) → `WorldModel`: four road arms with meander + connector lanes; frontage-driven village placement (church + steeple as landmark, town core, farmsteads); coarse-grid bocage patchwork with jittered parcels; hedgerow/wall/fence segments with road-clearance sampling and gate gaps; artillery damage (craters, ruined buildings, smoke sources); tactically chosen anchors (road-sited PaK with a cleared firing lane, MG nests at building corners, armor overwatch, reinforcement entry).

`Ground.ts` wraps the model in a sampler: fBm relief flattened toward the village, road-profile smoothing (terrain pulled to a low-passed along-road elevation), crater bowls with rims, rasterized road/field indices for O(1) classification. **Visuals and simulation share this one sampler** so they can never disagree about the ground.

Renderables: two-ring vertex-colored terrain chunks (2 m/6 m spacing) with per-vertex classification (crops with row striping, road shoulders, crater scorch, village-yard wear, moisture macro-variation); draped road strips with camber, cobble banding, wheel ruts and verge feathering; merged-geometry buildings with true window/door openings, tiled roofs, chimneys and three damage states; instanced dry-stone walls (individual stones), hedgerow berms + foliage-blob crowns, post-and-rail fences; instanced trees (3 archetypes × 4 species), props (carts, wells, haystacks…), near-field ground cover (grass clumps/gravel; road verges + village bowl); far-field annulus with patchwork colors, wood blobs and two distant village silhouettes to the 4 km horizon; procedural sky dome + billboard clouds.

## Simulation

Fixed 30 Hz tick (`core/Time.ts`) decoupled from render; systems run in a deterministic order: spotting → enemy AI → direct control → combat → suppression → capture. Path-finding is A* (binary heap, octile, no corner cutting, string-pulling) over a 2.5 m nav grid rasterized from the same world model, with separate vehicle/infantry masks, road cost bonuses, budgeted queue (3 searches/tick) and automatic re-path for partial long-route results. LOS is a 2.5D DDA over blocker heights + terrain + accumulated smoke opacity, with endpoint tolerance so units fire over their own cover.

Combat: cannon shells are substepped projectiles colliding with unit capsules, nav blockers and terrain; armor facing (front/side/rear) vs range-degraded penetration with ricochet chance; HE blast with cover/armor mitigation; MG/rifle hitscan bursts with suppression; crits (mobility/turret/burning DoT); vehicle wrecks stamp the nav/LOS grids. Emplacements get sandbag cover floors and pre-cleared firing lanes through their own bocage (spawn-time `breach`). Direct control shares this exact ballistics path.

Enemy AI is intel-limited: it acts on contacts its own units can see (6 s memory), dives to cover, swings MG arcs, falls back when flanked, repositions armor at standoff range, counter-attacks the zone past 35% progress and pushes reinforcements at 50%.

## Verification harness

`tools/launch.ts` probes Chromium flag sets for a WebGPU adapter (secure-context probe against the dev server, cached recipe) and auto-starts Vite. `shoot.ts` captures deterministic frames via `window.__oc` hooks (`ready/error/settle/stats`), stages its default tank frame on a real village road, and rejects browser/in-game diagnostics. `battery.ts` runs 19 checks driving the real game through `window.__oc.api` — genuine selection/orders/mode toggles; the only debug-only levers are health scaling and teleport staging, and even then outcomes (kills, capture, loss) are produced by the live simulation. Every check owns a console/page/in-game diagnostic gate. `final-shots.ts` proves each requested mission state before writing its six delivery frames. `compare.ts` fails unless every required side-by-side against `references/` is produced.

## Running without a GPU (SwiftShader containers)

The harness self-configures on CPU-only machines; the details matter if you touch it:

- **Launch recipe**: WebGPU works with SwiftShader Vulkan (`--enable-unsafe-webgpu --enable-features=Vulkan --use-vulkan=swiftshader --use-webgpu-adapter=swiftshader`) but ONLY headed — headless-new cannot allocate the WebGPU swapchain shared image (`SharedImageBackingFactory` missing → Device Lost on first present). `launch.ts` boots a shared Xvfb on `:99` (stale X lock detected via `/proc/<pid>`) and its probe renders a real canvas frame, not just `requestAdapter()` — an adapter-only probe happily accepts the broken headless config.
- **No 3D textures**: this Dawn/SwiftShader stack builds invalid 2D views for every 3D-texture operation (lazy zero-init and `writeTexture`), and each affected submit drops its whole command buffer. Volumetric-cloud noise therefore lives in 2D slice atlases with manual trilinear TSL sampling. Relatedly, `r16float` is not a legal STORAGE texture format per the WebGPU spec even where desktop Dawn tolerates it.
- **InstancedMesh colors**: pipelines compile against the attributes present at first render — call `setColorAt` once before the mesh first draws or instance tints are silently ignored.
- **Navigation pacing**: a busy render loop starves navigation commits; every tool parks on `about:blank` (fully awaited) and uses 180 s goto timeouts, because a timed-out goto leaves a pending navigation that interrupts every later one.
- **Wall time**: ~4–5 fps at 1080p high preset; screenshot timeouts are 180 s and the full battery is a multi-hour run on 4 CPU cores.

## Performance

High preset, RTX-class GPU @1080p headless: ~5.5–9.1 M triangles, 130–190 draw calls, 98–120 fps. Techniques: merged geometry per material family, InstancedMesh for everything repeated (stones, foliage, grass, soldiers, FX billboards), chunked terrain for frustum culling, shadow frustum following the camera with texel snapping, DOM-based HUD (zero per-frame canvas text), pooled particles/decals with circular buffers, staggered AI/spotting/cover scans, path budget per tick. Presets scale vertex spacing, instancing density, antialiasing, pixel ratio and shadow map size — never systems.

## Known limitations (see DELTA.md ledger)

Ground/facade detail is procedural-geometry class, not UE5/megascans class; the post stack is GTAO (half-res) + bloom + vignette on high/ultra with baked grounding AO in terrain vertex colors — there is no TAA chain (MSAA + restrained detail scale keep the image stable); smoke is billboard-based rather than volumetric; distant trees have no impostor atlas. All gameplay systems are complete and battery-verified.
