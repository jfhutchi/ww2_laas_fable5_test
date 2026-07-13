Original prompt: Preserve the final Fable 5 version on main and build a much better, more realistic Operation Crossroads game on a separate Codex branch. Fix the generic menu, right-click camera rotation, and map-relative WASD camera movement; make product and asset choices autonomously; iterate through implementation, playtest, visual review, and fixes until 8:00 AM America/New_York on Monday July 13, 2026.

## Completed

- Created isolated `codex/operation-crossroads-rebuild` worktree from synchronized `main` commit `9bb3aec`.
- Added failing pure and browser regressions for tactical input.
- Fixed DOM mouse-button mask ownership and delayed gesture handoff so right-click commands cannot orbit immediately or queue motion for a later middle-drag.
- Replaced the incorrect pan transform with tested camera-relative WASD/edge movement based on the rendered view during yaw smoothing.
- Rebuilt the menu DOM and CSS as a responsive field-operations dossier with bundled OFL fonts.
- Verified the menu contract in the battery, inspected WebGPU captures at 1280x720 and 720x900, and confirmed zero in-page errors.
- Unified tactical and tank HUDs around the dossier instrument system; added explicit mode/state semantics, keyboard-operable roster rows, focus proof, and non-overlap assertions.
- Rebuilt the Sherman hero asset with tapered cast armor, modeled running gear, deck fittings, stowage, a longer 75 mm gun, and subtle cast-steel surface detail.
- Replaced 560-triangle box soldiers with 2,144-triangle rounded, posed figures with webbing, pouches, boots, hands, helmets, and side-specific silhouettes.
- Reframed the tank chase camera to retain the complete vehicle and battlefield context; lifted cool sky and counter-sun bounce so backlit armor remains readable.
- Verified high/ultra WebGPU captures at 1600x900, with stable world hash, no page errors, and high-preset render throughput above 110 fps after initialization.
- Ran repeated complete real-game WebGPU batteries after major world changes and a fresh independent-review pass: the strengthened suite is 19/19 green in roughly three minutes.
- Bounded all health meters and formation command paths after live combat captures exposed 4,000%-wide debug-health bars and route-line clutter.
- Regraded the sky, softened volumetric cloud density/ambient response, and removed the redundant billboard layer for a blue-gray Normandy horizon with white cloud volume.
- Staged the southern approach with 12 poles, sagging three-wire spans, and objective-corner carts/crates/barrels/rubble while keeping the carriageways clear.
- Fixed detached building woodwork: frames, panes, doors, shutters, church openings, and tower openings now receive their wall transforms; added external slatted shutters and paneled doors.
- Added tested third-person building collision so the chase camera cannot enter facade volumes.
- Made facade-margin collision direction-aware for axis-aligned and rotated buildings, included pitched roofs, and kept damaged-church rafters attached through nave rotation.
- Hardened the release tools to reject empty battery selections, partial comparison sets, wrong final-shot mission states, and diagnostics from every scenario.
- Replaced repeated black roof cutouts with deterministic irregular tile edges and sloped warm-charred rafters/battens; added a pure breach-profile regression.
- Warm-started ambient building smoke into established battle columns and added a browser particle-floor assertion.
- Unified canonical/final village tank staging and made screenshot capture fail closed on browser/in-game diagnostics with guaranteed cleanup.
- Replaced the partial legacy world hash with a complete pure digest covering every layout entity, tactical anchor, and sampled terrain; added prop/damage sensitivity regressions.

## Current

- Stable post-polish checkpoint: install, tests, typecheck, build, fail-closed shoot, all three comparisons, 19/19 battery checks, all six asserted final states, and complete deterministic-content proof pass.
- Final branch/history/main-preservation audit and handoff preparation.

## Next

- Confirm the original `main` worktree remains byte-for-byte at the synchronized Fable 5 commit.
- Push the final checkpoint and keep the isolated branch ready for phone/desktop testing or a later pull request.
