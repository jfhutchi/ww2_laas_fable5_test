# Operation Crossroads — Prompt Pack

This folder contains the final no-compromise Fable 5 prompts for building **Operation Crossroads**, a complete WWII tactical/third-person browser game.

## Files

1. `FABLE5_WW2_MASTER_PROMPT.md`  
   Main end-to-end build prompt. Start here.

2. `FABLE5_WW2_NO_COMPROMISE_LAAS_CONTRACT.md`  
   Strict anti-prototype / no-compromise contract. Use after the master prompt or whenever scope starts shrinking.

3. `FABLE5_WW2_PHASE_EXECUTION_PROMPT.md`  
   Phase-by-phase execution prompt with closure gates.

4. `FABLE5_WW2_QA_SELF_REVIEW_PROMPT.md`  
   QA/reviewer prompt to force verification before claiming completion.

## Important Updates Included

- The project target is explicitly **not a prototype**.
- The project must use the existing `references/` folder.
- The `references/` folder is assumed to include both WWII reference images and LAAS project reference images.
- The prompt no longer accepts compromises as final limitations.
- `DEVIATIONS.md` has been replaced by `BLOCKERS.md`.
- Final delivery may contain zero open blockers.
- Runtime assets must be procedural.
- Reference images are used for comparison tooling, not copied as runtime textures.
- The final game must be playable, winnable, losable, verified, and visually benchmarked against LAAS v2.

## Recommended Usage

Paste the prompts into Fable 5 in this order:

1. `FABLE5_WW2_MASTER_PROMPT.md`
2. `FABLE5_WW2_NO_COMPROMISE_LAAS_CONTRACT.md`
3. `FABLE5_WW2_PHASE_EXECUTION_PROMPT.md`

After Fable claims a phase or final completion, paste:

4. `FABLE5_WW2_QA_SELF_REVIEW_PROMPT.md`
