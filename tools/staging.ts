import type { Page } from 'playwright';

export interface VillageTankStaging {
  x: number;
  z: number;
  objectiveDistance: number;
}

/** Stage the controlled Sherman on the south road inside the rebuilt town. */
export async function stageVillageTank(page: Page): Promise<VillageTankStaging> {
  return page.evaluate(() => {
    interface Unit {
      x: number;
      y: number;
      z: number;
      yaw: number;
      vel: number;
      driveThrottle: number;
      driveSteer: number;
    }
    interface App {
      controlledId: number;
      game: { byId: Map<number, Unit> } | null;
      world: {
        model: { roads: { roads: { points: { x: number; z: number }[] }[] } };
        sampleHeight(x: number, z: number): number;
      };
      tankTarget: { position: { set(x: number, y: number, z: number): void }; yaw: number };
      tankCam: { aimYaw: number; aimPitch: number; snapBehind(target: unknown): void };
    }
    const app = (window as unknown as { __ocDebug?: { app: App } }).__ocDebug?.app;
    const api = window.__oc.api;
    if (!app?.game || app.controlledId < 0 || !api) {
      throw new Error('controlled tank unavailable for village hero frame');
    }
    const unit = app.game.byId.get(app.controlledId);
    const road = app.world.model.roads.roads[2];
    const point = road?.points[7];
    const toward = road?.points[6];
    if (!unit || !point || !toward) throw new Error('southern road hero point unavailable');
    unit.x = point.x;
    unit.z = point.z;
    unit.y = app.world.sampleHeight(unit.x, unit.z);
    unit.yaw = Math.atan2(toward.z - point.z, toward.x - point.x);
    unit.vel = 0;
    unit.driveThrottle = 0;
    unit.driveSteer = 0;
    app.tankTarget.position.set(unit.x, unit.y, unit.z);
    app.tankTarget.yaw = unit.yaw;
    app.tankCam.aimYaw = unit.yaw;
    app.tankCam.aimPitch = -0.03;
    app.tankCam.snapBehind(app.tankTarget);
    const objective = api.objective();
    return {
      x: unit.x,
      z: unit.z,
      objectiveDistance: Math.hypot(unit.x - objective.x, unit.z - objective.z),
    };
  });
}
