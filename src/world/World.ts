/**
 * World: generates the deterministic Normandy layout and assembles every
 * procedural subsystem — terrain, buildings, barriers, foliage, props, far
 * scenery, sky, and the painted minimap. Everything derives from the seed.
 */

import { Group, Scene } from 'three';
import type { GraphicsPreset } from '../app/Config.ts';
import { generateLayout } from './Layout.ts';
import { Ground } from './Ground.ts';
import type { WorldModel } from './WorldTypes.ts';
import { buildTerrain } from './TerrainMesh.ts';
import { buildRoads } from './RoadMesh.ts';
import { buildAllBuildings } from '../assets/BuildingMeshes.ts';
import { buildBarriers } from '../assets/BarrierMeshes.ts';
import { buildFoliage } from '../assets/FoliageGenerator.ts';
import { buildProps } from '../assets/PropsGenerator.ts';
import { buildFarField } from './FarField.ts';
import { buildSky } from '../render/Sky.ts';
import { paintMinimap, type MinimapMaps } from './MinimapData.ts';
import { worldContentHash } from './WorldHash.ts';
import { buildGroundCover } from '../effects/GroundCover.ts';

export class World {
  readonly group = new Group();
  model!: WorldModel;
  ground!: Ground;
  minimap!: MinimapMaps;
  /** Deterministic hash of generated content — battery asserts seed reproducibility. */
  contentHash = 0;

  sampleHeight = (x: number, z: number): number => {
    return this.ground ? this.ground.height(x, z) : 0;
  };

  async build(
    seed: number,
    preset: GraphicsPreset,
    onProgress: (f: number, msg: string) => void,
    _scene?: Scene,
  ): Promise<void> {
    const yield_ = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

    onProgress(0.02, 'surveying the bocage (layout)');
    this.model = generateLayout(seed);
    await yield_();

    onProgress(0.1, 'grading roads and craters (ground)');
    this.ground = new Ground(this.model);
    await yield_();

    onProgress(0.2, 'terrain meshes');
    this.group.add(buildTerrain(this.model, this.ground, preset));
    await yield_();

    onProgress(0.32, 'paving roads');
    this.group.add(buildRoads(this.model, this.ground));
    await yield_();

    onProgress(0.38, 'raising the village');
    this.group.add(buildAllBuildings(this.model, this.ground));
    await yield_();

    onProgress(0.52, 'planting hedgerows and walls');
    this.group.add(buildBarriers(this.model, this.ground, preset));
    await yield_();

    onProgress(0.66, 'growing orchards and trees');
    this.group.add(buildFoliage(this.model, this.ground, preset));
    await yield_();

    onProgress(0.76, 'scattering carts, wells and rubble');
    this.group.add(buildProps(this.model, this.ground));
    await yield_();

    onProgress(0.82, 'growing grass and gravel (near-field cover)');
    this.group.add(buildGroundCover(this.model, this.ground, preset));
    await yield_();

    onProgress(0.85, 'far countryside');
    this.group.add(buildFarField(this.model, this.ground, preset));
    await yield_();

    if (_scene) {
      onProgress(0.9, 'sky and clouds');
      this.group.add(buildSky(_scene, seed));
      await yield_();
    }

    onProgress(0.94, 'drawing the field map');
    this.minimap = paintMinimap(this.model, this.ground, 1024);

    this.contentHash = worldContentHash(this.model, this.ground);

    onProgress(1, 'world ready');
  }

  /**
   * Reference framing for the third-person camera before a real tank is
   * under control: on the southern approach road, facing the village.
   */
  tankIntroPose(): { x: number; z: number; yaw: number } {
    const south = this.model.roads.roads[2];
    if (!south) return { x: 0, z: 200, yaw: -Math.PI / 2 };
    let acc = 0;
    const target = 195;
    for (let i = 0; i < south.points.length - 1; i++) {
      const a = south.points[i];
      const b = south.points[i + 1];
      if (!a || !b) continue;
      const seg = Math.hypot(b.x - a.x, b.z - a.z);
      if (acc + seg >= target) {
        const t = (target - acc) / seg;
        const x = a.x + (b.x - a.x) * t;
        const z = a.z + (b.z - a.z) * t;
        // face along the road toward the crossroads (reverse direction)
        const yaw = Math.atan2(a.z - b.z, a.x - b.x);
        return { x, z, yaw };
      }
      acc += seg;
    }
    return { x: 0, z: 200, yaw: -Math.PI / 2 };
  }
}
