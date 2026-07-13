# Operation Crossroads

A complete, playable WWII combined-arms browser game: command a small American force to capture and hold a procedurally generated Normandy village crossroads — from an RTS-style tactical view or from behind the gun of any of your Shermans, switching at will.

**WebGPU only · three.js WebGPURenderer · TypeScript strict · Vite · procedural geometry + bundled CC0 PBR surfaces · deterministic from `?seed=N`**

![Tactical view](shots/final/tactical_overhead.png)
![Third-person tank](shots/final/third_person_tank.png)

## Run

Requires a WebGPU-capable browser (Chrome/Edge 113+) and Node 20+.

```bash
npm install
npm run dev          # → http://localhost:5173
```

There is deliberately **no WebGL fallback** — unsupported browsers get a diagnostics screen.

### Verification

```bash
npm test             # pure regressions + owned dev-server lifecycle
npm run typecheck    # tsc --noEmit (strict, zero any)
npm run build        # typecheck + production bundle
npm run shoot        # Playwright: tactical/tank/HUD screenshots → shots/
npm run compare      # side-by-sides vs references/ → shots/compare/
npm run battery      # 19-check gameplay + presentation verification battery
npx tsx tools/final-shots.ts   # full final screenshot suite → shots/final/
```

The battery launches the real game in headless WebGPU Chromium and proves, among other things: deterministic seeds, strict right/middle gesture ownership, camera-relative movement during orbit smoothing, attached damaged-building geometry, full order-of-battle spawns, pathfinding, two-sided live fire, penetrations and wrecks, capture-state cycling, reinforcements at 50%, an actually winnable and losable mission, live minimap state, and zero console errors/exceptions/rejections after every scenario. The launcher regression also proves its owned Vite process exits cleanly, including on Windows.

## The mission — *Capture the Crossroads*

You command **3 Sherman M4A1s, 3 rifle squads and 2 scout teams** advancing up a shell-pocked road into a bocage-hemmed Normandy village held by German infantry, MG-42 teams, a road-sited PaK 40 and a StuG III. Take the central crossroads and hold it. At 50% capture progress, enemy armor and grenadier reinforcements arrive from the north.

- **Win:** fill the capture bar and hold the zone against contest until secured.
- **Lose:** your entire force is destroyed (or the timer expires on Hard).
- Difficulty (Easy/Normal/Hard) changes enemy accuracy, reaction time, damage and reinforcement timing. Hard adds a 25-minute mission timer.

Combat is simulated: shell projectiles with armor-facing penetration and ricochets, HE blast with cover mitigation, MG suppression that pins infantry, line-of-sight through real building/hedgerow/smoke occlusion, fog-of-war (enemies appear only when genuinely spotted — or when their muzzle flash gives them away), critical damage (mobility/turret/fires), and wrecks that persist as cover and obstacles.

## Controls

See [docs/CONTROLS.md](docs/CONTROLS.md) for the full table. Essentials:

| Key | Action |
|---|---|
| Tab | Toggle tactical ↔ direct tank control |
| Left click / drag | Select / box-select |
| Right click | Move — on a spotted enemy: attack |
| A / G / S / H | Attack-move / attack-ground / stop / hold |
| WASD | Pan relative to the tactical camera · drive (tank) |
| Mouse | Aim turret (tank mode) · LMB cannon, RMB MG |
| Space / Esc / F3 | Pause · menu · debug HUD |

## URL parameters

`?seed=N` `?preset=low|high|ultra` `?mission=crossroads` `?mode=tactical|tank|menu` `?difficulty=easy|normal|hard` `?hud=1` `?debug=1` `?freeze=1` `?speed=N` `?mute=1` `?cam=x,y,z,yaw,pitch,fov`

## Project layout

`src/world` — deterministic layout/terrain/roads/minimap generators · `src/assets` — procedural buildings, barriers, foliage, props, vehicles, infantry · `src/game` — simulation (state, combat, movement, LOS, capture, commands, direct control) · `src/ai` — enemy defense AI · `src/nav` — grid + A* · `src/render` — WebGPU renderer, cameras, lighting · `src/ui` — HUDs, menu, minimap · `src/effects` — combat FX, ground cover, capture flag · `src/audio` — procedural WebAudio · `tools/` — Playwright harness (shoot/compare/battery/final-shots).

Docs: [STATUS](docs/STATUS.md) · [DELTA](docs/DELTA.md) · [BLOCKERS](docs/BLOCKERS.md) · [GAMEPLAY](docs/GAMEPLAY.md) · [TECHNICAL_NOTES](docs/TECHNICAL_NOTES.md)
