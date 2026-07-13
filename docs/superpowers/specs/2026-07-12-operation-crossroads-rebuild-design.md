# Operation Crossroads Rebuild Design

## Intent

Build a substantially more convincing version of Operation Crossroads on the isolated `codex/operation-crossroads-rebuild` branch. The rebuild must preserve `main` as the final Fable 5 version, retain the existing deterministic gameplay contract, and replace the parts that currently read as a prototype: generic menus, ambiguous pointer ownership, map-relative camera input, weak visual hierarchy, sparse battle staging, and obviously procedural hero assets.

The result remains a browser game using TypeScript, Vite, Three.js, and WebGPU. It must launch without a service or account, bundle every runtime asset, and remain reproducible from `?seed=N`.

The platform choice is deliberate rather than a constraint inherited from the baseline. The current renderer already supplies the expensive native-engine foundations--WebGPU, TAA, GTAO, volumetric clouds, procedural world generation, live simulation, and automated capture--so an overnight engine migration would reduce the amount of finished game the user receives. The rebuild instead makes the browser version feel like a focused native tactics title.

## Success Criteria

1. `main` remains unchanged; all work lives on `codex/operation-crossroads-rebuild`.
2. Right-clicking to issue a move or attack order never rotates or tilts the tactical camera.
3. Tactical WASD input is camera-relative: W moves toward the top of the current view, S away, and A/D strafe relative to the view heading.
4. The menu and HUD have an authored WWII field-command identity instead of a generic centered-card treatment.
5. Tactical and tank views show materially better depth, surface response, silhouette quality, environmental density, and battle evidence than the synchronized `9bb3aec` baseline.
6. Existing gameplay remains real: selection, pathfinding, LOS, armor penetration, suppression, AI, capture, direct tank control, win/loss, minimap, and test hooks continue to use live simulation state.
7. Strict type-check, production build, screenshot capture, comparison generation, and the gameplay battery pass with no console errors.

## Chosen Direction

Use a presentation-first rebuild on the current engine and simulation core.

- Keep the deterministic fixed-step game model and its validated combat, navigation, AI, capture, and test seams.
- Rewrite input arbitration so each pointer gesture has a single owner and camera controls cannot consume command gestures.
- Redesign the UI around a 1944 operations-dossier visual language: aerial reconnaissance imagery, paper and ink layers, olive-black instrument panels, restrained brass accents, condensed military typography, and purposeful map-grid motion.
- Improve realism through better composition, physically plausible materials, higher-value hero geometry, layered ground detail, environmental storytelling, camera behavior, and post-processing rather than adding unrelated game modes.
- Prefer bundled CC0 assets from Poly Haven and ambientCG. CC-BY assets are allowed only when the exact author, source URL, license, and required attribution are committed with the asset. No runtime downloads are permitted.

### Alternatives Considered

1. **Full engine migration to Babylon.js or an off-the-shelf engine.** Rejected because it would discard the strongest working systems and spend the available iteration window rebuilding infrastructure instead of improving the game.
2. **Pure asset replacement.** Rejected because the input bugs, camera behavior, composition, UI, and simulation-to-presentation wiring would remain visibly weak.
3. **Presentation-first rebuild on Three.js/WebGPU.** Selected because it preserves proven behavior, supports the existing TSL render stack, and concentrates work where the reference delta is largest.

## Architecture

### Input Ownership

`Input` remains the raw event collector. `TacticalInput` owns left-button selection and right-button command gestures. `TacticalCamera` owns keyboard pan, wheel zoom, Q/E rotation, and middle-button orbit only. Camera orbit will never inspect the right button. Context-menu suppression remains scoped to the game canvas.

The camera exposes a ground-plane basis derived from its current yaw. Tactical pan converts the input vector `(strafe, forward)` through that basis before updating focus. The same basis is used for keyboard and edge-pan movement so both controls remain visually consistent after rotation.

### Interface Shell

`Menu` keeps its callback contract but receives new semantic markup: recon header, mission dossier, theater map panel, operation parameters, and a decisive primary action. `styles.css` becomes a tokenized visual system with bundled fonts, paper/film textures implemented as small local assets or CSS layers, responsive breakpoints, focus states, and reduced-motion support.

The tactical and tank HUDs retain live data bindings. Their presentation is tightened around common tokens so panels look like one instrument family rather than separate generated widgets.

### World and Rendering

The existing deterministic world model remains the source of truth. Visual systems may add derived, non-colliding detail, but may not move gameplay blockers without updating navigation and minimap data.

Realism work proceeds in this order:

1. Correct camera framing and movement feel.
2. Strengthen terrain material scale, road edges, facade breakup, and hero silhouettes.
3. Add staged clutter and battle evidence around the playable corridor without obscuring selection.
4. Improve smoke, dust, muzzle flash, impact readability, and color grading.
5. Tune density and post effects against desktop and software-rendered test captures.

External PBR material maps are normalized to game-ready WebP/JPEG sizes and loaded through one asset manifest. Every source and license is recorded in `public/assets/ATTRIBUTION.md`.

### Data Flow

Raw DOM events flow into `Input`. Each frame, the active mode chooses one controller: `TacticalInput` plus `TacticalCamera`, or `DirectControl` plus `TankCamera`. Commands update `GameState`; deterministic systems advance at 30 Hz; `UnitRenderer`, effects, HUD, markers, and minimaps render the same live state. Cosmetic world detail is derived from the world seed and never mutates simulation state.

### Error Handling

Asset load failures are surfaced through the existing fatal diagnostics path with the missing asset URL. Input handlers reject invalid or stale unit targets without issuing success-shaped commands. WebGPU initialization remains mandatory. No broad catch blocks or silent renderer fallbacks are introduced.

## Verification and Iteration Loop

Each iteration follows the same loop:

1. Add a focused regression test or battery assertion.
2. Make the smallest coherent implementation change.
3. Run strict type-check and build.
4. Capture tactical, menu, tank, combat, and objective-state screenshots.
5. Inspect images at desktop and mobile-safe viewport sizes.
6. Run the full gameplay battery.
7. Compare against the reference set and record remaining high-impact deltas.
8. Repeat in impact order until the deadline.

The first automated regressions cover right-click camera stability and camera-relative W/A/S/D. Visual acceptance covers menu hierarchy, tactical readability, tank silhouette, road/village composition, surface scale, atmosphere, and absence of overlapping HUD panels.

## Scope Boundaries

The rebuild does not add multiplayer, a campaign backend, user accounts, paid services, or runtime asset downloads. It does not replace working simulation merely to change architecture. Mobile browsers are not a primary gameplay target, but menus and diagnostics must remain readable on narrow screens.
