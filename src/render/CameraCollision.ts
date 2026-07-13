export interface CameraPoint {
  x: number;
  y: number;
  z: number;
}

export interface CameraBuilding {
  x: number;
  z: number;
  rotation: number;
  halfW: number;
  halfD: number;
  wallHeight: number;
}

export function clipCameraToBuildings<T extends CameraPoint>(
  anchor: CameraPoint,
  desired: CameraPoint,
  buildings: readonly CameraBuilding[],
  sampleHeight: (x: number, z: number) => number,
  out: T,
): T;
export function clipCameraToBuildings(
  anchor: CameraPoint,
  desired: CameraPoint,
  buildings: readonly CameraBuilding[],
  sampleHeight: (x: number, z: number) => number,
): CameraPoint;
export function clipCameraToBuildings(
  anchor: CameraPoint,
  desired: CameraPoint,
  buildings: readonly CameraBuilding[],
  sampleHeight: (x: number, z: number) => number,
  out?: CameraPoint,
): CameraPoint {
  const dx = desired.x - anchor.x;
  const dy = desired.y - anchor.y;
  const dz = desired.z - anchor.z;
  const horizontalLength = Math.hypot(dx, dz);
  let earliest = 1;

  for (const building of buildings) {
    const cos = Math.cos(building.rotation);
    const sin = Math.sin(building.rotation);
    const relX = anchor.x - building.x;
    const relZ = anchor.z - building.z;
    const originX = relX * cos + relZ * sin;
    const originZ = -relX * sin + relZ * cos;
    const directionX = dx * cos + dz * sin;
    const directionZ = -dx * sin + dz * cos;
    // Keep enough room for the near plane and shoulder offset, not merely
    // the mathematical camera point; close facades otherwise dominate frame.
    const halfW = building.halfW + 1.25;
    const halfD = building.halfD + 1.25;
    if (Math.abs(originX) <= halfW && Math.abs(originZ) <= halfD) continue;
    let enter = 0;
    let exit = 1;

    const clipAxis = (origin: number, direction: number, extent: number): boolean => {
      if (Math.abs(direction) < 1e-8) return Math.abs(origin) <= extent;
      const a = (-extent - origin) / direction;
      const b = (extent - origin) / direction;
      enter = Math.max(enter, Math.min(a, b));
      exit = Math.min(exit, Math.max(a, b));
      return enter <= exit;
    };

    if (!clipAxis(originX, directionX, halfW) || !clipAxis(originZ, directionZ, halfD)) continue;
    if (exit < 0 || enter > 1) continue;
    const hitT = Math.max(0, enter);
    const hitY = anchor.y + dy * hitT;
    const roofY = sampleHeight(building.x, building.z) + building.wallHeight + building.halfD * 1.1 + 0.4;
    if (hitY > roofY) continue;
    earliest = Math.min(earliest, hitT);
  }

  const clearanceT = horizontalLength > 1e-5 ? 0.7 / horizontalLength : 0;
  const safeT = earliest < 1 ? Math.max(0, earliest - clearanceT) : 1;
  const result = out ?? { x: 0, y: 0, z: 0 };
  result.x = anchor.x + dx * safeT;
  result.y = anchor.y + dy * safeT;
  result.z = anchor.z + dz * safeT;
  return result;
}
