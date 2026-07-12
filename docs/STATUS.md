# Operation Crossroads — STATUS

Complete playable WWII combined-arms browser game (WebGPU / three.js WebGPURenderer / TypeScript strict / Vite), built to the LAAS v2 production process translated into a Normandy setting. **All phases closed. Final acceptance gate passing.**

## Phase ledger

| Phase | Scope | Status |
|---|---|---|
| 0 | Scaffold: WebGPU boot + diagnostics, cameras, HUD shell, Playwright harness, docs | CLOSED |
| 1 | Procedural Normandy world: terrain, village, roads, fields, lighting | CLOSED |
| 2 | Units: Sherman/German armor/infantry/AT/MG, selection, commands, pathfinding | CLOSED |
| 3 | Combat: projectiles, armor model, suppression, cover, FX, audio | CLOSED |
| 4 | Mission/AI: capture zone, win/loss, enemy AI, LOS/fog-of-war, reinforcements | CLOSED |
| 5 | Third-person tank mode: driving, turret, firing, tank HUD, mode switching | CLOSED |
| 6 | Visual density & polish: ground cover, grade, dust/tracks, capture flag | CLOSED |
| 7 | Performance, verification, release: presets, battery, docs, final shots | CLOSED |

## Final acceptance

```
npm install      ✓
npm run typecheck ✓  (strict, zero any)
npm run build     ✓
npm run dev       ✓  (used by every harness run)
npm run shoot     ✓  shots/tactical.png, shots/tank.png, shots/debug_hud.png
npm run compare   ✓  shots/compare/{tactical_vs_references,tank_vs_references,laas_quality_vs_current}.png
npm run battery   ✓  15/15 checks
npx tsx tools/final-shots.ts ✓ shots/final/{tactical_overhead,third_person_tank,debug_hud,capture_contested,mission_won,mission_lost}.png
```

Battery proves: WebGPU init (no fallback) · deterministic seed (content-hash equality across loads, divergence across seeds) · full order of battle (3 Shermans, 3 rifle squads, 2 scouts vs PaK 40, 2 MG-42s, 5 grenadier squads, StuG III) · command + A* pathfinding over a 640 m march · two-sided live fire with cannon projectiles, hits and audio events · destruction with persistent vehicle wrecks · capture-state cycling with reinforcements at 50% · mission win via real capture · mission loss via real enemy fire · direct tank control (drive displacement, manual cannon shot, mode round-trip with tactical AI resuming) · live minimap terrain/unit binding · zero console errors, page exceptions or unhandled rejections over a 20 s combat-free run.

Performance (high preset, RTX-class, 1080p headless): ~5.5–9.1 M tris, 130–190 draws, 98–120 fps.

## Post-release iteration 5 (reference-similarity pass)

Closed on a CPU-only rig (WebGPU over SwiftShader, headed Xvfb) — see DELTA.md for the full ledger. Highlights: two real WebGPU spec violations fixed (r16float storage 3D textures + late instanceColor) that blacked out frames / whitened smoke off desktop-Dawn; `?cam=` framing actually applied (it never was — camera API added); terrain/roads moved onto the shared detail-material law; palette truthing vs `references/` (olive meadow with worn patches, weathered roofs, darker olive drab, muted grade); human-proportioned infantry; taller lit war smoke; volumetric deck restored via CPU-baked 2D slice atlases.

Battery re-verified **15/15** on the CPU-only rig itself (WebGPU over SwiftShader, ~5.5 h wall time) after the iteration-5/6 changes — including `no-errors-baseline` on the strict Vulkan validation stack.

Performance note: this container renders ~4–5 fps at 1080p (software rasterizer, 4 cores) — the RTX-class numbers above still describe real-GPU behavior.

## Open blockers

None — see [BLOCKERS.md](BLOCKERS.md).
