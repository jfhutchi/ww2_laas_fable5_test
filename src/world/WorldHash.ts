import type { GroundSampler, SpawnArea, WorldModel } from './WorldTypes.ts';

/** Stable FNV-style digest of every generated layout surface and terrain. */
export function worldContentHash(model: WorldModel, ground: Pick<GroundSampler, 'height'> | ((x: number, z: number) => number)): number {
  let hash = (0x9dc5 ^ model.seed) >>> 0;
  const mixInt = (value: number): void => {
    hash = Math.imul(hash ^ (value | 0), 0x01000193) >>> 0;
  };
  const mixNumber = (value: number): void => mixInt(Math.round(value * 1000));
  const mixBoolean = (value: boolean | undefined): void => mixInt(value === true ? 1 : 0);
  const mixString = (value: string): void => {
    mixInt(value.length);
    for (let i = 0; i < value.length; i++) mixInt(value.charCodeAt(i));
  };
  const mixSpawn = (spawn: SpawnArea): void => {
    mixNumber(spawn.x);
    mixNumber(spawn.z);
    mixNumber(spawn.facing);
  };

  mixInt(model.seed);
  mixNumber(model.roads.center.x);
  mixNumber(model.roads.center.z);
  for (const road of model.roads.roads) {
    mixInt(road.id);
    mixString(road.kind);
    mixNumber(road.width);
    mixInt(road.points.length);
    for (const point of road.points) {
      mixNumber(point.x);
      mixNumber(point.z);
    }
  }
  for (const building of model.buildings) {
    mixInt(building.id);
    mixString(building.kind);
    mixString(building.damage);
    mixNumber(building.x);
    mixNumber(building.z);
    mixNumber(building.rotation);
    mixNumber(building.halfW);
    mixNumber(building.halfD);
    mixNumber(building.wallHeight);
    mixInt(building.floors);
    mixInt(building.seed);
    mixBoolean(building.partyNegX);
    mixBoolean(building.partyPosX);
    mixBoolean(building.shop);
  }
  for (const barrier of model.barriers) {
    mixInt(barrier.id);
    mixString(barrier.kind);
    mixNumber(barrier.x0);
    mixNumber(barrier.z0);
    mixNumber(barrier.x1);
    mixNumber(barrier.z1);
    mixNumber(barrier.height);
    mixBoolean(barrier.blocksVehicles);
    mixBoolean(barrier.blocksSight);
    mixNumber(barrier.broken);
    mixInt(barrier.seed);
  }
  for (const field of model.fields) {
    mixInt(field.id);
    mixString(field.crop);
    mixNumber(field.rowDir);
    mixInt(field.seed);
    mixInt(field.polygon.length);
    for (const point of field.polygon) {
      mixNumber(point.x);
      mixNumber(point.z);
    }
  }
  for (const prop of model.props) {
    mixInt(prop.id);
    mixString(prop.kind);
    mixNumber(prop.x);
    mixNumber(prop.z);
    mixNumber(prop.rotation);
    mixNumber(prop.scale);
    mixInt(prop.seed);
  }
  for (const crater of model.craters) {
    mixInt(crater.id);
    mixNumber(crater.x);
    mixNumber(crater.z);
    mixNumber(crater.radius);
    mixNumber(crater.depth);
    mixNumber(crater.age);
  }
  for (const smoke of model.smokeSources) {
    mixInt(smoke.id);
    mixNumber(smoke.x);
    mixNumber(smoke.z);
    mixNumber(smoke.strength);
  }
  for (const zone of model.zones) {
    mixString(zone.kind);
    mixNumber(zone.x);
    mixNumber(zone.z);
    mixNumber(zone.radius);
  }
  mixNumber(model.captureZone.x);
  mixNumber(model.captureZone.z);
  mixNumber(model.captureZone.radius);
  mixSpawn(model.playerSpawn);
  mixSpawn(model.enemyAnchors.atGun);
  for (const nest of model.enemyAnchors.mgNests) mixSpawn(nest);
  for (const infantry of model.enemyAnchors.infantry) mixSpawn(infantry);
  mixSpawn(model.enemyAnchors.armor);
  mixSpawn(model.enemyAnchors.reinforcementsEntry);

  const sampleHeight = typeof ground === 'function' ? ground : (x: number, z: number) => ground.height(x, z);
  for (let gz = -8; gz <= 8; gz++) {
    for (let gx = -8; gx <= 8; gx++) mixNumber(sampleHeight(gx * 40, gz * 40));
  }
  return hash;
}
