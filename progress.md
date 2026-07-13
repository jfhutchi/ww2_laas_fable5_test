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

## Current

- Run the complete gameplay and presentation battery against the rebuilt UI, inputs, hero assets, and lighting.
- Rank the next visual deltas from live combat/mission-state captures, led by architecture detail, repetitive ground scatter, and effects composition.

## Next

- Regenerate comparison and final mission-state frames after the full battery is green.
- Continue the ranked visual-delta loop without changing the deterministic gameplay contract.
