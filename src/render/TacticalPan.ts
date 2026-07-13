/** Transform screen-relative tactical input onto the camera's ground plane. */
export function cameraRelativePan(yaw: number, strafe: number, forward: number): { x: number; z: number } {
  const sin = Math.sin(yaw);
  const cos = Math.cos(yaw);
  return {
    x: -sin * forward + cos * strafe,
    z: -cos * forward - sin * strafe,
  };
}
