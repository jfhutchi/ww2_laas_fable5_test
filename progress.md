Original prompt: Preserve the final Fable 5 version on main and build a much better, more realistic Operation Crossroads game on a separate Codex branch. Fix the generic menu, right-click camera rotation, and map-relative WASD camera movement; make product and asset choices autonomously; iterate through implementation, playtest, visual review, and fixes until 8:00 AM America/New_York on Monday July 13, 2026.

## Completed

- Created isolated `codex/operation-crossroads-rebuild` worktree from synchronized `main` commit `9bb3aec`.
- Added failing pure and browser regressions for tactical input.
- Fixed DOM mouse-button mask ownership so right-click commands cannot orbit the camera.
- Replaced the incorrect pan transform with tested camera-relative WASD/edge movement.
- Rebuilt the menu DOM and CSS as a responsive field-operations dossier with bundled OFL fonts.
- Verified the menu contract in the battery, inspected WebGPU captures at 1280x720 and 720x900, and confirmed zero in-page errors.
- Unified tactical and tank HUDs around the dossier instrument system; added explicit mode/state semantics, keyboard-operable roster rows, focus proof, and non-overlap assertions.
- Rebuilt the Sherman hero asset with tapered cast armor, modeled running gear, deck fittings, stowage, a longer 75 mm gun, and subtle cast-steel surface detail.
- Replaced 560-triangle box soldiers with 2,144-triangle rounded, posed figures with webbing, pouches, boots, hands, helmets, and side-specific silhouettes.
- Reframed the tank chase camera to retain the complete vehicle and battlefield context; lifted cool sky and counter-sun bounce so backlit armor remains readable.
- Verified high/ultra WebGPU captures at 1600x900, with stable world hash, no page errors, and high-preset render throughput above 110 fps after initialization.
- Ran the complete real-game WebGPU battery twice after major world changes: 18/18 checks green in roughly three minutes per run.
- Bounded all health meters and formation command paths after live combat captures exposed 4,000%-wide debug-health bars and route-line clutter.
- Regraded the sky, softened volumetric cloud density/ambient response, and removed the redundant billboard layer for a blue-gray Normandy horizon with white cloud volume.
- Staged the southern approach with 12 poles, sagging three-wire spans, and objective-corner carts/crates/barrels/rubble while keeping the carriageways clear.
- Fixed detached building woodwork: frames, panes, doors, shutters, church openings, and tower openings now receive their wall transforms; added external slatted shutters and paneled doors.
- Added tested third-person building collision so the chase camera cannot enter facade volumes.

## Current

- Rerun the complete battery after the facade and camera-collision pass.
- Review live combat effects and the final mission-state suite for the next highest-impact defect.

## Next

- Regenerate canonical comparison/final frames with the atmosphere, staging, and facade passes.
- Continue the ranked visual-delta loop without changing the deterministic gameplay contract, then write the final branch/status handoff.
