# Operation Crossroads Rebuild Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver an art-directed, more realistic Operation Crossroads build with correct tactical input, a redesigned interface, stronger battlefield presentation, and a fully green release harness.

**Architecture:** Preserve the deterministic simulation and rebuild the presentation and input seams around it. Pure control transforms receive fast Node assertions; browser-visible behavior receives Playwright battery checks; visual work is accepted through deterministic screenshot comparison and repeated manual image inspection.

**Tech Stack:** TypeScript 5.7, Vite 6, Three.js 0.184 WebGPU/TSL, Playwright, Sharp, Fontsource OFL fonts, CC0 PBR assets.

---

## File Map

- Create `src/core/PointerButtons.ts`: normalize DOM button indices to the `MouseEvent.buttons` bitmask.
- Create `src/render/TacticalPan.ts`: pure camera-relative ground-plane pan transform.
- Create `tools/control-regressions.ts`: deterministic assertions for button ownership and camera basis math.
- Modify `src/core/Input.ts`: use normalized button masks.
- Modify `src/render/TacticalCamera.ts`: consume the pure pan transform and reserve orbit for the middle button.
- Modify `tools/battery.ts`: add browser-level control and menu regressions.
- Modify `package.json`: expose focused and aggregate test scripts and add bundled fonts.
- Modify `src/main.ts`: import local Fontsource faces.
- Rewrite `src/ui/Menu.ts`: semantic operations-dossier menu layout while preserving callback behavior.
- Rewrite the menu and shared token sections of `src/ui/styles.css`: authored responsive visual system.
- Modify `src/ui/TacticalHud.ts` and `src/ui/TankHud.ts`: add shared instrument semantics needed by the new styles.
- Modify `src/assets/TankGenerator.ts`: improve hero-vehicle silhouette and close-camera detail.
- Modify `src/assets/BuildingMeshes.ts`, `src/assets/PropsGenerator.ts`, and `src/effects/GroundCover.ts`: add derived facade, roadside, and battle-damage detail.
- Modify `src/render/PostStack.ts`, `src/render/Lighting.ts`, and `src/effects/CombatFX.ts`: tune cinematic readability without changing simulation.
- Modify `tools/shoot.ts`, `tools/compare.ts`, `docs/DELTA.md`, `docs/STATUS.md`, and `docs/ASSETS.md`: add proof and licensing records for the rebuild.

### Task 1: Encode the control regressions

**Files:**
- Create: `tools/control-regressions.ts`
- Modify: `package.json`

- [ ] **Step 1: Write the failing pure regression test**

```ts
import assert from 'node:assert/strict';
import { pointerButtonMask } from '../src/core/PointerButtons.ts';
import { cameraRelativePan } from '../src/render/TacticalPan.ts';

assert.equal(pointerButtonMask(0), 1, 'left button owns the primary mask');
assert.equal(pointerButtonMask(1), 4, 'middle button owns the auxiliary mask');
assert.equal(pointerButtonMask(2), 2, 'right button owns the secondary mask');

assert.deepEqual(cameraRelativePan(0, 0, 1), { x: 0, z: -1 });
const eastFacing = cameraRelativePan(Math.PI / 2, 0, 1);
assert.ok(Math.abs(eastFacing.x + 1) < 1e-9);
assert.ok(Math.abs(eastFacing.z) < 1e-9);
```

Add `"test:controls": "tsx tools/control-regressions.ts"` and `"test": "npm run test:controls"` to `package.json`.

- [ ] **Step 2: Run the test and verify RED**

Run: `npm run test:controls`

Expected: FAIL because `PointerButtons.ts` and `TacticalPan.ts` do not exist.

- [ ] **Step 3: Add a browser regression for right-drag ownership**

Append a `tactical-input-ownership` battery check that boots tactical mode, captures `window.__oc.api.getCameraPose()`, right-drags 140 pixels, settles frames, and asserts yaw and pitch are unchanged within `0.001`.

- [ ] **Step 4: Run the targeted battery and verify RED**

Run: `npm run battery -- --grep tactical-input-ownership`

Expected: FAIL because a right-button drag is interpreted as auxiliary-button orbit.

- [ ] **Step 5: Commit the red tests**

Run: `git add package.json package-lock.json tools/control-regressions.ts tools/battery.ts && git commit -m "test: capture tactical input regressions"`

### Task 2: Fix pointer ownership and camera-relative pan

**Files:**
- Create: `src/core/PointerButtons.ts`
- Create: `src/render/TacticalPan.ts`
- Modify: `src/core/Input.ts`
- Modify: `src/render/TacticalCamera.ts`

- [ ] **Step 1: Implement DOM button normalization**

```ts
export function pointerButtonMask(button: number): number {
  if (button === 0) return 1;
  if (button === 1) return 4;
  if (button === 2) return 2;
  return 0;
}
```

Use this helper on mouse down/up instead of `1 << e.button`. Keep the camera orbit check on mask `4`, which now means middle button as the DOM specifies.

- [ ] **Step 2: Implement the camera basis transform**

```ts
export function cameraRelativePan(yaw: number, strafe: number, forward: number): { x: number; z: number } {
  const sin = Math.sin(yaw);
  const cos = Math.cos(yaw);
  return {
    x: -sin * forward + cos * strafe,
    z: -cos * forward - sin * strafe,
  };
}
```

Use W/Up as `forward += 1`, S/Down as `forward -= 1`, D/Right as `strafe += 1`, and A/Left as `strafe -= 1`. Normalize the resulting world vector before applying distance-scaled speed.

- [ ] **Step 3: Run focused tests and verify GREEN**

Run: `npm run test:controls && npm run battery -- --grep tactical-input-ownership`

Expected: pure assertions pass and the browser reports one passing battery check.

- [ ] **Step 4: Run type-check and build**

Run: `npm run typecheck && npm run build`

Expected: both commands exit zero.

- [ ] **Step 5: Commit the control fixes**

Run: `git add src/core/PointerButtons.ts src/core/Input.ts src/render/TacticalPan.ts src/render/TacticalCamera.ts && git commit -m "fix: separate tactical commands from camera controls"`

### Task 3: Redesign the operations menu

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `src/main.ts`
- Modify: `src/ui/Menu.ts`
- Modify: `src/ui/styles.css`
- Modify: `tools/battery.ts`

- [ ] **Step 1: Add a failing menu-structure battery check**

Create a `menu-dossier` check that boots `mode=menu` and asserts `#menu-dossier`, `#menu-recon-map`, `.menu-briefing`, `.menu-operation-code`, and a visible primary `.menu-btn` exist. Assert the computed `#menu-card` display is `grid` above 1000px.

- [ ] **Step 2: Run the targeted check and verify RED**

Run: `npm run battery -- --grep menu-dossier`

Expected: FAIL because the dossier structure does not exist.

- [ ] **Step 3: Bundle expressive OFL fonts**

Run: `npm install @fontsource/barlow-condensed@5.2.7 @fontsource/ibm-plex-mono@5.2.7`

Import Barlow Condensed weights 400/600/700 and IBM Plex Mono weights 400/600 in `src/main.ts`. No runtime font requests are allowed.

- [ ] **Step 4: Rewrite the semantic menu markup**

Build a two-column dossier with these stable elements: classification strip, split title, mission date/location, reconnaissance map with route and objective marker, briefing copy, operation settings, action buttons, and expandable field manual. Preserve `onStart`, `onResume`, `onRestart`, and `onQuitToMenu` exactly.

- [ ] **Step 5: Build the authored CSS system**

Define paper, ink, brass, olive, danger, and glass tokens; layer map grid, paper grain, vignette, and film noise through CSS gradients; use asymmetric grid composition; add one staged dossier reveal; provide `prefers-reduced-motion` and a single-column breakpoint below 760px.

- [ ] **Step 6: Verify GREEN and capture the menu**

Run: `npm run battery -- --grep menu-dossier && npm run typecheck && npm run build`

Expected: menu check passes and build remains green.

- [ ] **Step 7: Commit the menu rebuild**

Run: `git add package.json package-lock.json src/main.ts src/ui/Menu.ts src/ui/styles.css tools/battery.ts && git commit -m "feat: rebuild menu as a field operations dossier"`

### Task 4: Unify and polish the live HUD

**Files:**
- Modify: `src/ui/styles.css`
- Modify: `src/ui/TacticalHud.ts`
- Modify: `src/ui/TankHud.ts`
- Modify: `src/ui/Minimap.ts`

- [ ] **Step 1: Add a failing HUD layout battery assertion**

Assert tactical objective/roster panels do not overlap, command controls stay inside the viewport, tank objective/telemetry do not overlap the circular minimap, and every interactive control has a nonzero focus outline style.

- [ ] **Step 2: Run the HUD assertion and verify RED**

Run: `npm run battery -- --grep hud-layout`

Expected: FAIL on the new instrument/focus criteria.

- [ ] **Step 3: Apply the shared instrument system**

Use the dossier typography and tokens for panel titles, telemetry, buttons, health bars, capture state, and minimap frame. Add semantic data attributes for side, urgency, and selected state instead of styling from text.

- [ ] **Step 4: Verify HUD behavior**

Run: `npm run battery -- --grep hud-layout && npm run typecheck`

Expected: assertions and type-check pass.

- [ ] **Step 5: Commit the HUD pass**

Run: `git add src/ui/styles.css src/ui/TacticalHud.ts src/ui/TankHud.ts src/ui/Minimap.ts tools/battery.ts && git commit -m "feat: unify tactical and tank instrumentation"`

### Task 5: Improve hero assets and battlefield staging

**Files:**
- Modify: `src/assets/TankGenerator.ts`
- Modify: `src/assets/BuildingMeshes.ts`
- Modify: `src/assets/PropsGenerator.ts`
- Modify: `src/effects/GroundCover.ts`
- Modify: `docs/ASSETS.md`

- [ ] **Step 1: Capture deterministic before frames**

Run: `npm run shoot -- --extra noclouds=1`

Preserve tactical, tank, and combat frames under `shots/codex/before/` for local comparison.

- [ ] **Step 2: Add tank close-read geometry**

Add Sherman cupola/periscopes, mantlet breakup, tow cable, pioneer tools, suspension bogie relief, rear deck vents, and varied stowage. Add matching StuG/Panzer hatch, exhaust, track-return, and spare-link detail. Keep each vehicle below 80k visible triangles and preserve existing rig node names.

- [ ] **Step 3: Add facade and road narrative detail**

Add deterministic shutters, gutters/downpipes, lintels, shop/inn signs, utility poles and wires, road drains, carts, crates, barrels, fuel cans, sandbags, and localized rubble. Every placed blocker must either remain cosmetic or update the nav grid through existing world specs.

- [ ] **Step 4: Increase near-camera surface breakup**

Add ditch grass, tire ruts, verge stones, weeds against walls, shell fragments, and crater rim scatter using instancing and seed-forked placement. Avoid the command corridor and selection markers.

- [ ] **Step 5: Verify performance and gameplay**

Run: `npm run typecheck && npm run build && npm run battery`

Expected: build passes, battery is fully green, and debug HUD remains within the documented high/ultra draw-call budget.

- [ ] **Step 6: Commit the world-detail pass**

Run: `git add src/assets src/effects/GroundCover.ts docs/ASSETS.md && git commit -m "feat: deepen vehicle and battlefield detail"`

### Task 6: Tune combat cinematography

**Files:**
- Modify: `src/render/PostStack.ts`
- Modify: `src/render/Lighting.ts`
- Modify: `src/effects/CombatFX.ts`
- Modify: `src/render/TankCamera.ts`

- [ ] **Step 1: Add deterministic visual-state captures**

Extend `tools/shoot.ts` with menu, low tank chase, muzzle-flash, impact-smoke, and contested-crossroads frames driven by real test API actions.

- [ ] **Step 2: Tune the render stack**

Balance aerial perspective, contrast, split tone, bloom threshold, and exposure so skies retain detail, olive vehicles separate from terrain, and shadow values remain readable. Do not increase saturation globally.

- [ ] **Step 3: Improve combat effects and camera feel**

Layer short hot muzzle cores with longer smoke, directional impact debris, heavier tank dust, persistent ember/fire sources, and distance-scaled camera impulse. Add camera collision against terrain and blockers without changing aim direction.

- [ ] **Step 4: Verify state and stability**

Run: `npm run shoot && npm run compare && npm run battery && npm run typecheck && npm run build`

Expected: captures exist, all battery checks pass, and there are no WebGPU validation or console errors.

- [ ] **Step 5: Commit the cinematography pass**

Run: `git add src/render src/effects/CombatFX.ts tools/shoot.ts && git commit -m "feat: tune combat cinematography and camera feel"`

### Task 7: Repeated visual review and release proof

**Files:**
- Modify: `docs/DELTA.md`
- Modify: `docs/STATUS.md`
- Modify: `docs/BLOCKERS.md`
- Modify: `README.md`
- Modify: `tools/compare.ts`

- [ ] **Step 1: Run the complete acceptance gate**

Run: `npm ci && npm test && npm run typecheck && npm run build && npm run shoot && npm run compare && npm run battery && npx tsx tools/final-shots.ts`

Expected: every command exits zero and the battery reports all checks passing.

- [ ] **Step 2: Inspect every final and comparison image**

Review menu, tactical, tank, combat, contested, won, lost, and debug frames. Rank the five largest remaining deltas by visual impact and fix the top three through another test/build/capture/battery loop.

- [ ] **Step 3: Repeat until the deadline or no material delta remains**

Continue the ranked-delta loop with one coherent commit per pass. Never trade away gameplay correctness, input ownership, or deterministic verification for a screenshot-only improvement.

- [ ] **Step 4: Update release documentation**

Record branch, controls, asset licenses, acceptance commands, battery count, performance, screenshots, resolved blockers, and honest remaining deltas.

- [ ] **Step 5: Commit the release state**

Run: `git add README.md docs tools/compare.ts && git commit -m "docs: publish Codex rebuild verification"`

