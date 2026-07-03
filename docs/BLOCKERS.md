# Blockers

Active defects blocking required features. Blockers are not accepted limitations — every entry must reach `Status: Fixed` before final delivery. Final delivery requires **zero open blockers**.

**Zero open blockers.**

## Resolved during development (ledger)

## B1 — Roads invisible in all views
- Required feature: Road network readable in tactical + tank views
- Current failure: Road mesh rasterized nothing; terrain road tint illegible
- Root cause: Triangle winding inverted for the road strip's row/column axes (faces pointed down); road palette luminance-matched the grass under ACES
- Implementation plan: Flip winding; dedicated draped RoadMesh with camber/ruts/verges; palette separation + dark shoulders
- Files affected: src/world/RoadMesh.ts, src/world/TerrainMesh.ts
- Test proving fix: shots/debug-cross.png shows the crossroads reading clearly; compare set regenerated
- Status: Fixed

## B2 — Defenders blind/immobile inside buildings
- Required feature: Enemy AI engages the player (battery: enemy fires)
- Current failure: shotsByEnemy stayed 0; defenders died without firing
- Root cause: Infantry/MG anchors at building centers (inside solid nav cells); PaK sited behind the frontage house row with no line of fire; emplacements behind own 3 m bocage
- Implementation plan: Edge anchors toward the threat axis; spawn-time passability snap; prepared firing lanes breached through own cover; PaK re-sited to the road shoulder
- Files affected: src/world/Layout.ts, src/game/GameState.ts, src/nav/Pathfinding.ts
- Test proving fix: battery `combat-engagement` (both sides fire, hits land) passes repeatedly
- Status: Fixed

## B3 — Long marches stalled short of the goal
- Required feature: Units obey move orders across the map (battery: units-commandable)
- Current failure: Column halted ~120 m in, order flipped to idle
- Root cause: A* expansion cap returns partial paths; arrival logic treated partial-path end as order completion; field hedgerows also crossed roads (midpoint-only clearance test) walling the axis
- Implementation plan: Re-path until true arrival; multi-sample road clearance for barrier pieces (9 m pieces)
- Files affected: src/game/GameState.ts, src/game/Movement.ts, src/world/Layout.ts
- Test proving fix: battery `units-commandable` (640 m march) passes
- Status: Fixed

## B4 — Roof tiles rendered as venetian blinds
- Required feature: Buildings with believable tiled gable roofs
- Current failure: Tile rows floated perpendicular to the slope
- Root cause: rotateX sign inverted relative to slope side
- Implementation plan: Flip per-side pitch sign
- Files affected: src/assets/BuildingMeshes.ts
- Test proving fix: tactical captures show closed tiled roofs incl. damage holes
- Status: Fixed

## B5 — Headless pointer-lock crash blocked tank mode
- Required feature: Tab into direct tank control (battery: tank-mode)
- Current failure: Mode never switched in battery
- Root cause: requestPointerLock throws/rejects without a user gesture, aborting enterTankMode
- Implementation plan: Guard + swallow rejection; aiming works without lock
- Files affected: src/core/Input.ts
- Test proving fix: battery `tank-mode` passes (drive displacement + manual shot + round-trip)
- Status: Fixed
