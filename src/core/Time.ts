/**
 * Fixed-timestep simulation clock decoupled from render framerate.
 * The simulation always advances in SIM_DT increments so gameplay is
 * deterministic for a given seed + command sequence, independent of fps.
 */

export const SIM_DT = 1 / 30; // 30 Hz simulation tick
const MAX_FRAME_DT = 0.25; // clamp long stalls (tab switch, shader compile)
const MAX_TICKS_PER_FRAME = 12;

export class Time {
  /** Simulation speed multiplier. 0 = paused, 0.5 slow, 1 normal, 2 fast. */
  speed = 1;
  /** Hard freeze (?freeze=1): sim halts entirely but rendering continues. */
  frozen = false;

  /** Total simulated seconds. */
  simTime = 0;
  /** Total sim ticks executed. */
  simTick = 0;
  /** Wall-clock render delta of the current frame (seconds). */
  renderDt = 0;
  /** Frames rendered since boot. */
  frame = 0;

  private accumulator = 0;
  private lastMs: number | null = null;

  /** Smoothed fps estimate for the HUD. */
  fps = 0;
  frameMs = 0;

  /**
   * Advance from a rAF timestamp; invokes tick(SIM_DT) zero or more times.
   * Returns the number of sim ticks executed this frame.
   */
  advance(nowMs: number, tick: (dt: number) => void): number {
    const rawDt = this.lastMs === null ? 0 : (nowMs - this.lastMs) / 1000;
    this.lastMs = nowMs;
    const dt = Math.min(rawDt, MAX_FRAME_DT);
    this.renderDt = dt;
    this.frame++;

    if (dt > 0) {
      const inst = 1 / dt;
      this.fps = this.fps === 0 ? inst : this.fps * 0.95 + inst * 0.05;
      this.frameMs = this.frameMs === 0 ? dt * 1000 : this.frameMs * 0.95 + dt * 1000 * 0.05;
    }

    if (this.frozen || this.speed <= 0) {
      this.accumulator = 0;
      return 0;
    }

    this.accumulator += dt * this.speed;
    let ticks = 0;
    while (this.accumulator >= SIM_DT && ticks < MAX_TICKS_PER_FRAME) {
      tick(SIM_DT);
      this.simTime += SIM_DT;
      this.simTick++;
      this.accumulator -= SIM_DT;
      ticks++;
    }
    if (ticks === MAX_TICKS_PER_FRAME) this.accumulator = 0; // drop backlog, keep interactive
    return ticks;
  }

  /** Interpolation alpha for rendering between sim states. */
  get alpha(): number {
    return this.frozen || this.speed <= 0 ? 1 : Math.min(1, this.accumulator / SIM_DT);
  }
}
