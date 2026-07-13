# External Assets

All photo textures are **CC0 1.0 Universal** (public domain, no attribution required)
from [ambientCG](https://ambientcg.com) — license text: https://docs.ambientcg.com/license/.
Downloaded at 1K-JPG resolution to keep the repo lean; only the three maps the
renderer consumes are committed per asset (`_Color`, `_Roughness`, `_Displacement`
— normals are derived in-shader by finite-differencing the displacement, see
`src/render/MaterialDetail.ts`). Files keep their original ambientCG names under
`public/textures/<AssetID>/`.

| Asset ID | Used for | Source URL | License |
|---|---|---|---|
| Grass001 | Meadow albedo set A + ground-cover blades | https://ambientcg.com/view?id=Grass001 | CC0 |
| Grass004 | Meadow albedo set B (drier olive, patch-blended) | https://ambientcg.com/view?id=Grass004 | CC0 |
| Ground048 | Dirt cart roads, plow/crop soil, hedgerow berms | https://ambientcg.com/view?id=Ground048 | CC0 |
| Gravel022 | Cart-road gravel wear patches / shoulders | https://ambientcg.com/view?id=Gravel022 | CC0 |
| PavingStones128 | Cobbled parvis, town-square apron, paved north arm | https://ambientcg.com/view?id=PavingStones128 | CC0 |
| PaintedPlaster017 | Lime-render facade coat (plaster/stone houses, church) | https://ambientcg.com/view?id=PaintedPlaster017 | CC0 |
| Bricks076C | Brick-painted townhouses, chimneys, window trims | https://ambientcg.com/view?id=Bricks076C | CC0 |
| Rock023 | Dry-stone walls, ground-cover stones (layered limestone) | https://ambientcg.com/view?id=Rock023 | CC0 |
| RoofingTiles012A | Terracotta roofs | https://ambientcg.com/view?id=RoofingTiles012A | CC0 |
| RoofingTiles013A | Slate roofs (barns, sheds, church) | https://ambientcg.com/view?id=RoofingTiles013A | CC0 |
| Bark012 | Tree trunks | https://ambientcg.com/view?id=Bark012 | CC0 |
| Metal005 | Tank armor (pitted cast steel, hull/turret) | https://ambientcg.com/view?id=Metal005 | CC0 |
| Metal038 | Tank tracks (scuffed dark steel) | https://ambientcg.com/view?id=Metal038 | CC0 |
| Fabric066 | Infantry uniforms, canvas stowage, sandbags | https://ambientcg.com/view?id=Fabric066 | CC0 |
| LeafSet016 | Oak canopy cards (Color + Opacity) | https://ambientcg.com/view?id=LeafSet016 | CC0 |
| LeafSet004 | Poplar canopy cards | https://ambientcg.com/view?id=LeafSet004 | CC0 |
| LeafSet023 | Apple/orchard canopy cards | https://ambientcg.com/view?id=LeafSet023 | CC0 |
| LeafSet014 | Hedgerow/bush canopy cards | https://ambientcg.com/view?id=LeafSet014 | CC0 |

Notes:

- The committed LeafSet `_Color` maps are **modified** from the originals
  (CC0 permits this): the white scan background is flood-filled with each
  set's mean leaf colour so alpha-test edges don't fringe white and distant
  mipmaps blend toward foliage green instead of thinning out. Originals are
  at the source URLs; the fill script logic lives in the iteration-7 notes
  in DELTA.md.

- The brief named `Plaster017`, `RoofingTiles012` and `RoofingTiles013`; those
  exact IDs do not exist on ambientCG (`get?file=` returns "download not
  found"). The closest real assets were substituted: `PaintedPlaster017`,
  `RoofingTiles012A`, `RoofingTiles013A`.
- `Rock035` (dark wet basalt), `Ground037` (mossy forest floor) and
  `Plaster003` (too-smooth trowel finish) were downloaded, previewed and
  rejected — wrong palette/structure for Normandy; not committed.
- A Poly Haven golden-hour puresky HDRI was considered and **not wired**: a
  prior photographic-sky trial was rejected as blurry (see the comment in
  `App.init`), and the current procedural dome + softened volumetric cloud
  deck is the verified look. The redundant horizon billboard layer is disabled.
- Everything else in the game (meshes, minimap canvas, FX sprites, audio)
  remains procedurally generated in code — see TECHNICAL_NOTES.md.
