Original prompt: Preserve the final Fable 5 version on main and build a much better, more realistic Operation Crossroads game on a separate Codex branch. Fix the generic menu, right-click camera rotation, and map-relative WASD camera movement; make product and asset choices autonomously; iterate through implementation, playtest, visual review, and fixes until 8:00 AM America/New_York on Monday July 13, 2026.

## Completed

- Created isolated `codex/operation-crossroads-rebuild` worktree from synchronized `main` commit `9bb3aec`.
- Added failing pure and browser regressions for tactical input.
- Fixed DOM mouse-button mask ownership so right-click commands cannot orbit the camera.
- Replaced the incorrect pan transform with tested camera-relative WASD/edge movement.
- Rebuilt the menu DOM and CSS as a responsive field-operations dossier with bundled OFL fonts.
- Verified the menu contract in the battery, inspected WebGPU captures at 1280x720 and 720x900, and confirmed zero in-page errors.

## Current

- Add text-state and deterministic time-step compatibility for the web-game test client where it can reuse existing hooks.
- Build the shared tactical/tank HUD instrument pass and verify non-overlap/focus behavior.

## Next

- Unify tactical and tank HUD styling.
- Capture the synchronized visual baseline, rank deltas, then improve hero assets, staging, combat effects, and camera feel.
- Run the complete battery and release capture loop after each coherent pass.
