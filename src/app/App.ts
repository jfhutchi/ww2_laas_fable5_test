/**
 * Application conductor: owns the renderer, scene, cameras, world, UI and
 * the master update loop, plus the GameState lifecycle (mission start /
 * restart / end) and the real-command test API used by the battery.
 */

import { Scene, Color, Fog, Vector3 } from 'three';
import type { Config, Difficulty, GraphicsPreset } from './Config.ts';
import type { OcHooks, OcStats, OcTestApi } from './Hooks.ts';
import { reportProgress } from './Hooks.ts';
import { Renderer } from '../render/Renderer.ts';
import { Lighting } from '../render/Lighting.ts';
import { PostStack } from '../render/PostStack.ts';
import { buildEnvironment } from '../render/Environment.ts';
import { buildCloudCoverage } from '../render/CloudShadows.ts';
import { VolumetricClouds } from '../render/VolumetricClouds.ts';
import { TacticalCamera } from '../render/TacticalCamera.ts';
import { TankCamera, type TankCameraTarget } from '../render/TankCamera.ts';
import { DebugHud } from '../render/DebugHud.ts';
import { Time } from '../core/Time.ts';
import { Input } from '../core/Input.ts';
import { EventBus } from '../core/EventBus.ts';
import { World } from '../world/World.ts';
import { Menu } from '../ui/Menu.ts';
import { Hud } from '../ui/Hud.ts';
import { GameState } from '../game/GameState.ts';
import { Commands } from '../game/Commands.ts';
import { Spotting } from '../game/Spotting.ts';
import { Suppression } from '../game/Suppression.ts';
import { Capture } from '../game/Capture.ts';
import { Combat } from '../game/Combat.ts';
import { EnemyAI } from '../ai/EnemyAI.ts';
import { DirectControl } from '../game/DirectControl.ts';
import { TankHud } from '../ui/TankHud.ts';
import { CombatFX } from '../effects/CombatFX.ts';
import { CaptureFlag } from '../effects/CaptureFlag.ts';
import { GameAudio } from '../audio/Audio.ts';
import { UnitRenderer } from '../game/UnitRenderer.ts';
import { TacticalInput } from '../game/TacticalInput.ts';
import { TacticalHud } from '../ui/TacticalHud.ts';
import { UnitMarkers } from '../ui/UnitMarkers.ts';
import { Minimap } from '../ui/Minimap.ts';
import { ARCHETYPES } from '../game/Types.ts';
import { snapToPassable } from '../nav/Pathfinding.ts';

export type GameMode = 'menu' | 'tactical' | 'tank';

export class App {
  readonly config: Config;
  readonly hooks: OcHooks;
  readonly renderer: Renderer;
  readonly scene = new Scene();
  readonly time = new Time();
  readonly input = new Input();
  readonly bus = new EventBus();
  readonly world = new World();
  readonly tacticalCam: TacticalCamera;
  readonly tankCam: TankCamera;
  lighting!: Lighting;
  menu!: Menu;
  hud!: Hud;
  debugHud!: DebugHud;

  // game session (constructed per mission)
  game: GameState | null = null;
  commands: Commands | null = null;
  capture: Capture | null = null;
  combat: Combat | null = null;
  readonly directControl = new DirectControl();
  private fx: CombatFX | null = null;
  private audio: GameAudio;
  private unitRenderer: UnitRenderer | null = null;
  private tacticalInput: TacticalInput | null = null;
  private tacticalHud: TacticalHud | null = null;
  private tankHud: TankHud | null = null;
  private tankMinimap: Minimap | null = null;
  private markers: UnitMarkers | null = null;
  private minimap: Minimap | null = null;
  private driveOverride: { throttle: number; steer: number; until: number } | null = null;
  private captureFlag: CaptureFlag | null = null;
  private vclouds: VolumetricClouds | null = null;
  private post: PostStack | null = null;
  private dustAcc = new Map<number, number>();
  private trackAcc = new Map<number, { x: number; z: number }>();

  mode: GameMode = 'menu';
  /** Id of the vehicle under direct control in tank mode. */
  controlledId = -1;
  private tankTarget: TankCameraTarget = { position: new Vector3(0, 0, 0), yaw: 0 };

  private settleWaiters: { remaining: number; resolve: () => void }[] = [];
  private appEl: HTMLElement;

  constructor(config: Config, hooks: OcHooks) {
    this.config = config;
    this.hooks = hooks;
    const el = document.getElementById('app');
    if (!el) throw new Error('#app container missing');
    this.appEl = el;
    this.renderer = new Renderer(config.preset);
    const aspect = window.innerWidth / Math.max(1, window.innerHeight);
    this.tacticalCam = new TacticalCamera(aspect);
    this.tankCam = new TankCamera(aspect);
    this.audio = new GameAudio(config.mute);
    this.audio.attach(this.bus);
  }

  async init(): Promise<void> {
    const { hooks, config } = this;
    reportProgress(hooks, 0.05, 'initializing WebGPU renderer');
    await this.renderer.init();
    this.appEl.append(this.renderer.canvas);
    this.onResize();
    window.addEventListener('resize', () => this.onResize());

    reportProgress(hooks, 0.15, 'lighting');
    this.scene.background = new Color(0.62, 0.7, 0.82);
    // high/ultra get post-space aerial perspective (per-channel extinction,
    // altitude haze, sun-side scatter); linear fog only serves the low preset
    if (config.preset === 'low') {
      this.scene.fog = new Fog(new Color(0.79, 0.73, 0.63), 720, 4000);
    }
    this.lighting = new Lighting(this.scene, config.preset);
    buildEnvironment(this.scene, 0.5);

    reportProgress(hooks, 0.2, 'generating world');
    await this.world.build(
      config.seed,
      config.preset,
      (f, msg) => reportProgress(hooks, 0.2 + f * 0.6, msg),
      this.scene,
    );
    this.scene.add(this.world.group);
    this.tacticalCam.sampleHeight = (x, z) => this.world.sampleHeight(x, z);
    this.tankCam.sampleHeight = (x, z) => this.world.sampleHeight(x, z);

    // CSM fits the active view camera
    this.lighting.setShadowCamera(this.tacticalCam.camera);

    // default tactical framing: over the crossroads from the approach side
    const spawn = this.world.model.playerSpawn;
    this.tacticalCam.focusOn(0, 8, 150);
    this.tacticalCam.yaw = Math.atan2(spawn.x, spawn.z);
    const intro = this.world.tankIntroPose();
    this.tankTarget.position.set(intro.x, this.world.sampleHeight(intro.x, intro.z), intro.z);
    this.tankTarget.yaw = intro.yaw;

    reportProgress(hooks, 0.85, 'interface');
    this.hud = new Hud(this.appEl);
    this.debugHud = new DebugHud(this.appEl, config.hud);
    this.menu = new Menu(
      this.appEl,
      {
        onStart: (o) => this.startMission(o),
        onResume: () => this.resume(),
        onRestart: (o) => this.restartMission(o),
        onQuitToMenu: () => this.quitToMenu(),
      },
      config.seed,
      config.difficulty,
      config.preset,
    );
    this.input.attach(this.appEl);

    if (config.mode === 'menu') {
      this.menu.showMain();
    } else {
      this.startMission({ seed: config.seed, difficulty: config.difficulty, preset: config.preset });
      if (config.mode === 'tank') this.enterTankMode();
    }
    this.time.frozen = config.freeze;
    this.time.speed = config.speed;

    hooks.settle = (frames: number) =>
      new Promise<void>((resolve) => {
        this.settleWaiters.push({ remaining: Math.max(1, frames), resolve });
      });

    if (config.debug) {
      (window as unknown as { __ocDebug?: unknown }).__ocDebug = { app: this };
    }

    // GTAO + aerial perspective + volumetric clouds + bloom + grade
    if (config.preset !== 'low') {
      const noClouds = new URLSearchParams(location.search).get('noclouds') === '1';
      const sunToward = this.lighting.sunDir.clone().negate();
      if (!noClouds) {
        reportProgress(hooks, 0.91, 'baking cloud noise');
        this.vclouds = new VolumetricClouds(config.seed, sunToward);
        await this.vclouds.init(this.renderer.three);
      }
      reportProgress(hooks, 0.93, 'post-processing stack');
      this.post = new PostStack(
        this.renderer.three,
        this.scene,
        [this.tacticalCam.camera, this.tankCam.camera],
        buildCloudCoverage(config.seed),
        this.vclouds,
      );
    }

    reportProgress(hooks, 0.97, 'first frame');
    this.renderer.three.setAnimationLoop((t) => this.frame(t));
  }

  // ------------------------------------------------------------------ flow

  startMission(opts: { seed: number; difficulty: Difficulty; preset: GraphicsPreset }): void {
    if (opts.seed !== this.config.seed || opts.preset !== this.config.preset) {
      // world must regenerate — reload with the new parameters
      const q = new URLSearchParams(window.location.search);
      q.set('seed', String(opts.seed));
      q.set('preset', opts.preset);
      q.set('difficulty', opts.difficulty);
      q.set('mode', 'tactical');
      window.location.search = q.toString();
      return;
    }
    this.teardownGame();

    const gs = new GameState(this.world.model, this.world.ground, this.bus, opts.difficulty);
    this.game = gs;
    this.commands = new Commands(gs);
    this.capture = new Capture();
    this.combat = new Combat();
    gs.systems.push(
      { name: 'spotting', tick: (g, dt) => spotting.tick(g, dt) },
      { name: 'enemy-ai', tick: (g, dt) => enemyAI.tick(g, dt) },
      {
        name: 'direct-control',
        tick: (g, dt) => {
          if (this.combat && this.controlledId >= 0) {
            this.directControl.tick(g, dt, this.combat, this.controlledId);
          }
        },
      },
      { name: 'combat', tick: (g, dt) => this.combat?.tick(g, dt) },
      { name: 'suppression', tick: (g, dt) => suppression.tick(g, dt) },
      { name: 'capture', tick: (g, dt) => this.capture?.tick(g, dt) },
    );
    this.directControl.onCannonFired = () => this.tankCam.addShake(0.9);
    const spotting = new Spotting();
    const suppression = new Suppression();
    const enemyAI = new EnemyAI();

    this.fx = new CombatFX(this.scene, this.bus, this.world.ground);
    this.fx.addAmbientSources(this.world.model.smokeSources);
    const zone = this.world.model.captureZone;
    this.captureFlag = new CaptureFlag(zone.x, this.world.sampleHeight(zone.x, zone.z), zone.z, zone.radius);
    this.scene.add(this.captureFlag.group);

    this.unitRenderer = new UnitRenderer(this.scene, gs, this.world.ground);
    this.tacticalInput = new TacticalInput(this.appEl, gs, this.commands, this.world.ground);
    this.tacticalHud = new TacticalHud(this.hud.root, gs, this.commands, {
      onSpeed: (m) => {
        this.time.speed = m;
      },
      onMenu: () => {
        this.menu.showPaused();
        this.time.speed = 0;
      },
      onFocusUnit: (u) => this.tacticalCam.focusOn(u.x, u.z),
      onCommandMode: (m) => {
        if (this.commands) this.commands.mode = m;
      },
      onStop: () => this.commands?.stop(),
      onHold: () => this.commands?.hold(),
      onDirectControl: () => this.enterTankMode(),
    });
    this.tankHud = new TankHud(this.hud.root, gs, this.bus, () => this.controlledId, {
      onReturnToCommand: () => this.exitTankMode(),
    });
    this.tankHud.setVisible(false);
    this.tankMinimap = new Minimap(
      this.hud.root,
      this.world.minimap,
      { onFocus: () => undefined, onMoveOrder: () => undefined },
      { sizePx: 196, circular: true, id: 'tank-minimap' },
    );
    this.tankMinimap.container.style.display = 'none';
    this.markers = new UnitMarkers(this.hud.root, gs, (id, additive) => this.commands?.select([id], additive));
    this.minimap = new Minimap(
      this.hud.root,
      this.world.minimap,
      {
        onFocus: (x, z) => this.tacticalCam.focusOn(x, z),
        onMoveOrder: (x, z) => this.commands?.order('move', x, z),
      },
      { sizePx: 248, circular: false, id: 'tactical-minimap' },
    );

    // camera opens on the player force (unless an explicit ?cam pose was given)
    if (this.config.cam) {
      this.tacticalCam.setPose(this.config.cam);
      // harness framing: hold the requested pose against input drift
      // (headless pointers park at the viewport edge and would edge-pan)
      if (this.config.freeze) this.tacticalCam.enabled = false;
    } else {
      this.tacticalCam.focusOn(spawnMid(gs).x, spawnMid(gs).z, 130);
    }

    this.menu.hide();
    this.setMode('tactical');
    this.installApi(gs);
    this.bus.emit('mission:start', { seed: opts.seed, difficulty: opts.difficulty });

    // mission end hooks (unsubscribed on teardown so restarts don't stack)
    this.missionSubs.push(
      this.bus.on('mission:won', () => {
        this.time.speed = Math.min(this.time.speed, 1);
        setTimeout(() => this.menu.showEnd(true, `Crossroads secured in ${fmtTime(gs.missionTime)}.`), 1600);
      }),
      this.bus.on('mission:lost', ({ reason }) => {
        this.time.speed = Math.min(this.time.speed, 1);
        setTimeout(() => this.menu.showEnd(false, reason), 1600);
      }),
    );
  }

  private missionSubs: (() => void)[] = [];

  private teardownGame(): void {
    for (const unsub of this.missionSubs) unsub();
    this.missionSubs = [];
    this.fx?.dispose();
    this.fx = null;
    if (this.captureFlag) {
      this.captureFlag.group.removeFromParent();
      this.captureFlag = null;
    }
    this.dustAcc.clear();
    this.trackAcc.clear();
    this.combat = null;
    this.tankHud?.destroy();
    this.tankHud = null;
    this.tankMinimap?.destroy();
    this.tankMinimap = null;
    this.unitRenderer?.dispose();
    this.tacticalInput?.destroy();
    this.tacticalHud?.destroy();
    this.markers?.destroy();
    this.minimap?.destroy();
    this.unitRenderer = null;
    this.tacticalInput = null;
    this.tacticalHud = null;
    this.markers = null;
    this.minimap = null;
    this.game = null;
    this.commands = null;
    this.capture = null;
    this.controlledId = -1;
  }

  restartMission(opts: { seed: number; difficulty: Difficulty; preset: GraphicsPreset }): void {
    const q = new URLSearchParams(window.location.search);
    q.set('seed', String(opts.seed));
    q.set('preset', opts.preset);
    q.set('difficulty', opts.difficulty);
    q.set('mode', 'tactical');
    window.location.search = q.toString();
  }

  resume(): void {
    this.menu.hide();
    if (this.mode === 'menu' && this.game) this.setMode('tactical');
    this.time.speed = Math.max(this.time.speed, 1);
  }

  quitToMenu(): void {
    this.teardownGame();
    this.setMode('menu');
    this.menu.showMain();
  }

  /** Tab: control the selected Sherman, or the nearest living one. */
  enterTankMode(): void {
    const gs = this.game;
    if (!gs) {
      this.tankCam.snapBehind(this.tankTarget);
      this.setMode('tank');
      return;
    }
    let tank = this.commands
      ?.selectedUnits()
      .find((u) => ARCHETYPES[u.cls].kind === 'vehicle' && u.alive);
    if (!tank) {
      // nearest living Sherman to the camera focus
      let bestD = Infinity;
      for (const u of gs.units) {
        if (u.side !== 'player' || !u.alive || ARCHETYPES[u.cls].kind !== 'vehicle') continue;
        const d = Math.hypot(u.x - this.tacticalCam.focusX, u.z - this.tacticalCam.focusZ);
        if (d < bestD) {
          bestD = d;
          tank = u;
        }
      }
    }
    if (!tank) return; // no living tank — stay tactical
    this.controlledId = tank.id;
    tank.directControl = true;
    tank.path = null;
    this.tankTarget.position.set(tank.x, tank.y, tank.z);
    this.tankTarget.yaw = tank.yaw;
    this.tankCam.snapBehind(this.tankTarget);
    this.directControl.aimYaw = tank.yaw;
    this.directControl.aimPitch = -0.02;
    this.audio.startEngine();
    this.input.requestPointerLock();
    this.setMode('tank');
  }

  exitTankMode(): void {
    const gs = this.game;
    if (gs) {
      const u = gs.byId.get(this.controlledId);
      if (u) {
        u.directControl = false;
        u.driveThrottle = 0;
        u.driveSteer = 0;
        // tactical autopilot resumes: hold position until re-tasked
        gs.issueOrder(u, { type: 'hold', x: u.x, z: u.z, targetId: -1 });
      }
    }
    this.controlledId = -1;
    this.audio.stopEngine();
    this.setMode(this.game ? 'tactical' : 'menu');
  }

  setMode(mode: GameMode): void {
    if (this.mode === mode) return;
    this.mode = mode;
    this.post?.onCameraSwap(); // flush TAA history — stale reprojection ghosts
    this.lighting.setShadowCamera(mode === 'tank' ? this.tankCam.camera : this.tacticalCam.camera);
    this.bus.emit('mode:changed', { mode });
    if (mode !== 'tank') this.input.exitPointerLock();
    const tacticalVisible = mode === 'tactical';
    this.tacticalHud?.setVisible(tacticalVisible);
    this.markers?.setVisible(tacticalVisible);
    if (this.minimap) this.minimap.container.style.display = tacticalVisible ? 'block' : 'none';
    this.tankHud?.setVisible(mode === 'tank');
    if (this.tankMinimap) this.tankMinimap.container.style.display = mode === 'tank' ? 'block' : 'none';
  }

  get activeCamera(): TacticalCamera['camera'] {
    return this.mode === 'tank' ? this.tankCam.camera : this.tacticalCam.camera;
  }

  // ------------------------------------------------------------------ loop

  private frame(nowMs: number): void {
    const dt = Math.min(0.1, this.time.renderDt || 1 / 60);
    const gs = this.game;

    // keys: global first, then tactical hotkeys
    for (const key of this.input.drainPressed()) {
      if (this.handleGlobalKey(key)) continue;
      if (this.mode === 'tactical' && this.tacticalInput) {
        this.tacticalInput.handleKey(key, this.input.key('Control'));
      }
    }

    // pointer interaction
    const clicks = this.input.drainClicks();
    if (this.mode === 'tactical' && this.tacticalInput && !this.menu.visible) {
      this.tacticalInput.update(
        this.input,
        clicks,
        this.tacticalCam.camera,
        this.renderer.canvas.clientWidth,
        this.renderer.canvas.clientHeight,
      );
    }

    // simulation
    this.time.advance(nowMs, (simDt) => {
      gs?.tick(simDt);
    });
    this.commands?.prune();

    // cameras
    if (this.mode === 'tank') {
      const mv = this.input.takeMouseMove();
      if (this.input.pointerLocked) this.tankCam.addAim(mv.dx, mv.dy);
      const u = gs?.byId.get(this.controlledId);
      if (u) {
        // drive inputs (keys or test-api override)
        const ovr = this.driveOverride;
        if (ovr && gs && this.time.simTime < ovr.until) {
          u.driveThrottle = ovr.throttle;
          u.driveSteer = ovr.steer;
        } else {
          this.driveOverride = null;
          u.driveThrottle = (this.input.key('W') ? 1 : 0) + (this.input.key('S') ? -1 : 0);
          u.driveSteer = (this.input.key('D') ? 1 : 0) + (this.input.key('A') ? -1 : 0);
        }
        this.directControl.overdrive = this.input.key('Shift');
        this.directControl.aimYaw = this.tankCam.aimYaw;
        this.directControl.aimPitch = this.tankCam.aimPitch;
        // fire inputs: clicks queue shots; held RMB keeps the MG talking
        for (const click of clicks) {
          if (click.button === 0) this.directControl.wantFireCannon = true;
          if (click.button === 2) this.directControl.wantFireMG = true;
        }
        if ((this.input.pointer.buttons & 2) !== 0) this.directControl.wantFireMG = true;
        if (!this.input.pointerLocked && clicks.some((c) => c.button === 0)) {
          this.input.requestPointerLock();
        }
        this.audio.setEngine(u.driveThrottle, Math.abs(u.vel));

        this.tankTarget.position.set(u.x, u.y, u.z);
        this.tankTarget.yaw = u.yaw;
        if (!u.alive) this.exitTankMode();
      }
      this.tankCam.update(dt, this.tankTarget);
    } else {
      this.tacticalCam.update(
        dt,
        this.input,
        this.renderer.canvas.clientWidth,
        this.renderer.canvas.clientHeight,
      );
    }

    const cam = this.activeCamera;
    this.lighting.follow(
      this.mode === 'tank' ? this.tankTarget.position.x : this.tacticalCam.focusX,
      this.mode === 'tank' ? this.tankTarget.position.z : this.tacticalCam.focusZ,
    );

    // visuals bound to sim
    if (gs && this.unitRenderer && this.commands) {
      this.unitRenderer.update(this.commands.selection);
    }
    if (this.fx) {
      // shell tracers from live projectiles
      if (this.combat) {
        for (const p of this.combat.projectiles) {
          if (p.weapon.kind !== 'cannon') continue;
          const k = 0.045;
          this.fx.traceShell(p.x - p.vx * k, p.y - p.vy * k, p.z - p.vz * k, p.x, p.y, p.z);
        }
      }
      // vehicle dust + persistent track marks
      if (gs) {
        for (const u of gs.units) {
          if (!u.alive || Math.abs(u.vel) < 1.2) continue;
          const arch = ARCHETYPES[u.cls];
          if (arch.kind !== 'vehicle') continue;
          const acc = (this.dustAcc.get(u.id) ?? 0) + dt * Math.abs(u.vel);
          if (acc > 2.2) {
            this.dustAcc.set(u.id, 0);
            this.fx.vehicleDust(u.x, u.y, u.z, u.yaw, Math.abs(u.vel) / arch.speed);
          } else {
            this.dustAcc.set(u.id, acc);
          }
          const last = this.trackAcc.get(u.id);
          if (!last || Math.hypot(u.x - last.x, u.z - last.z) > 3.4) {
            this.trackAcc.set(u.id, { x: u.x, z: u.z });
            if (last) this.fx.trackMark(u.x, u.y, u.z, u.yaw);
          }
        }
      }
      this.fx.update(dt, cam);
    }
    this.captureFlag?.update(dt, gs?.captureStateLabel ?? 'Neutral', gs?.captureProgress ?? 0);
    this.audio.setListener({ x: cam.position.x, y: cam.position.y, z: cam.position.z });

    if (this.post) this.post.setDriftTime(this.time.simTime);
    if (this.vclouds && !this.time.frozen && this.time.speed > 0) {
      this.vclouds.tick(dt * this.time.speed);
    }
    if (!this.post || !this.post.render(cam)) {
      this.renderer.three.render(this.scene, cam);
    }

    // UI updates
    const w = this.renderer.canvas.clientWidth;
    const h = this.renderer.canvas.clientHeight;
    if (gs && this.commands) {
      if (this.mode === 'tactical') {
        this.markers?.update(cam, w, h, this.commands.selection);
        this.tacticalHud?.update(nowMs, this.time.speed, {
          state: gs.captureStateLabel,
          progress: gs.captureProgress,
        });
        this.minimap?.update(nowMs, gs, cam);
      } else if (this.mode === 'tank') {
        this.tankHud?.update(cam, this.tankCam.aimYaw, w, h, gs.captureStateLabel, gs.captureProgress);
        const u = gs.byId.get(this.controlledId);
        if (u) this.tankMinimap?.update(nowMs, gs, cam, { x: u.x, z: u.z });
      }
    }

    this.publishStats();
    this.debugHud.update(nowMs, this.hooks.stats as OcStats, {});

    if (this.settleWaiters.length > 0) {
      const stillWaiting: typeof this.settleWaiters = [];
      for (const wtr of this.settleWaiters) {
        wtr.remaining--;
        if (wtr.remaining <= 0) wtr.resolve();
        else stillWaiting.push(wtr);
      }
      this.settleWaiters = stillWaiting;
    }
  }

  /** Returns true when the key was a consumed global action. */
  private handleGlobalKey(key: string): boolean {
    switch (key) {
      case 'F3':
        this.debugHud.toggle();
        return true;
      case 'Escape':
        if (this.mode === 'menu') return true;
        if (this.menu.visible) {
          this.menu.hide();
          this.resume();
        } else {
          this.menu.showPaused();
          this.time.speed = 0;
        }
        return true;
      case 'Tab':
        if (this.mode === 'tactical') this.enterTankMode();
        else if (this.mode === 'tank') this.exitTankMode();
        return true;
      case 'Space':
        if (this.mode === 'tactical' && !this.menu.visible) {
          this.time.speed = this.time.speed === 0 ? 1 : 0;
        }
        return true;
      case 'C':
        if (this.mode === 'tank') {
          this.tankCam.cyclePreset();
          return true;
        }
        return false;
      case 'P': {
        const pose = this.tacticalCam.getPose();
        // eslint-disable-next-line no-console
        console.log(
          `[oc] seed=${this.config.seed} cam=${pose.x},${pose.y},${pose.z},${pose.yaw},${pose.pitch},${pose.fov}`,
        );
        return true;
      }
      default:
        return false;
    }
  }

  // ------------------------------------------------------------------ api

  private installApi(gs: GameState): void {
    const commands = this.commands;
    if (!commands) return;
    const api: OcTestApi = {
      selectAll: () => commands.selectAllPlayer(),
      selectType: (type: string) => {
        const ids = gs.units.filter((u) => u.side === 'player' && u.alive && u.cls.includes(type)).map((u) => u.id);
        commands.select(ids, false);
        return ids.length;
      },
      move: (x, z) => commands.order('move', x, z),
      attackMove: (x, z) => commands.order('attack-move', x, z),
      stop: () => commands.stop(),
      setSpeed: (m) => {
        this.time.speed = m;
      },
      toggleMode: () => {
        if (this.mode === 'tactical') this.enterTankMode();
        else if (this.mode === 'tank') this.exitTankMode();
      },
      startMission: () =>
        this.startMission({ seed: this.config.seed, difficulty: this.config.difficulty, preset: this.config.preset }),
      objective: () => ({ x: gs.model.captureZone.x, z: gs.model.captureZone.z }),
      getCameraPose: () => this.tacticalCam.getPose(),
      setCameraPose: (pose) => {
        this.tacticalCam.enabled = false; // scripted framing — hold the pose
        this.tacticalCam.setPose(pose);
      },
      debugScene: () => {
        if (!this.config.debug) return [];
        const out: { name: string; kind: string; visible: boolean; count: number; tris: number }[] = [];
        for (const child of this.world.group.children) {
          let tris = 0;
          let count = 0;
          child.traverse((o) => {
            const mesh = o as { isMesh?: boolean; isInstancedMesh?: boolean; count?: number; geometry?: { index: { count: number } | null; attributes: { position?: { count: number } } } };
            if (mesh.isMesh && mesh.geometry) {
              count++;
              const idx = mesh.geometry.index;
              const per = (idx ? idx.count : (mesh.geometry.attributes.position?.count ?? 0)) / 3;
              tris += per * (mesh.isInstancedMesh ? (mesh.count ?? 1) : 1);
            }
          });
          out.push({ name: child.name || '(unnamed)', kind: child.type, visible: child.visible, count, tris: Math.round(tris) });
        }
        return out;
      },
      units: (side) =>
        gs.units
          .filter((u) => u.side === side && u.alive)
          .map((u) => ({ id: u.id, type: u.cls, x: u.x, z: u.z, hp: u.hp })),
      debugScaleHealth: (side, mult) => {
        if (!this.config.debug) return;
        for (const u of gs.units) {
          if (u.side === side && u.alive) u.hp = Math.max(1, u.hp * mult);
        }
      },
      debugTeleportSelection: (x, z) => {
        if (!this.config.debug) return;
        let i = 0;
        for (const u of commands.selectedUnits()) {
          const vehicle = ARCHETYPES[u.cls].kind !== 'infantry';
          const spot = snapToPassable(gs.nav, x + (i % 3) * 7 - 7, z + Math.floor(i / 3) * 7, vehicle);
          u.x = spot.x;
          u.z = spot.z;
          u.path = null;
          u.order = { type: 'idle', x: u.x, z: u.z, targetId: -1 };
          i++;
        }
      },
      fire: () => {
        this.directControl.wantFireCannon = true;
      },
      drive: (throttle, steer, seconds) => {
        this.driveOverride = { throttle, steer, until: this.time.simTime + seconds };
      },
    };
    this.hooks.api = api;
  }

  private publishStats(): void {
    const r = this.renderer.stats();
    const stats: OcStats = this.hooks.stats ?? {
      render: {
        frame: 0, fps: 0, frameMs: 0, drawCalls: 0, triangles: 0, points: 0, lines: 0,
        geometries: 0, textures: 0,
      },
      game: null,
      seed: this.config.seed,
      preset: this.config.preset,
      worldHash: 0,
      errors: [],
    };
    stats.render.frame = this.time.frame;
    stats.render.fps = this.time.fps;
    stats.render.frameMs = this.time.frameMs;
    stats.render.drawCalls = r.drawCalls;
    stats.render.triangles = r.triangles;
    stats.render.points = r.points;
    stats.render.lines = r.lines;
    stats.render.geometries = r.geometries;
    stats.render.textures = r.textures;
    stats.worldHash = this.world.contentHash;
    stats.game = this.game
      ? this.game.publishStats(this.time.simTick, this.time.simTime, this.mode)
      : null;
    this.hooks.stats = stats;
  }

  private onResize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const ratio = Math.min(window.devicePixelRatio, this.config.preset === 'low' ? 1 : 1.5);
    this.renderer.resize(w, h, ratio);
    for (const cam of [this.tacticalCam.camera, this.tankCam.camera]) {
      cam.aspect = w / Math.max(1, h);
      cam.updateProjectionMatrix();
    }
  }
}

function spawnMid(gs: GameState): { x: number; z: number } {
  let x = 0;
  let z = 0;
  let n = 0;
  for (const u of gs.units) {
    if (u.side !== 'player') continue;
    x += u.x;
    z += u.z;
    n++;
  }
  return n > 0 ? { x: x / n, z: z / n } : { x: 0, z: 0 };
}

function fmtTime(t: number): string {
  const mm = Math.floor(t / 60);
  const ss = Math.floor(t % 60).toString().padStart(2, '0');
  return `${mm}:${ss}`;
}
