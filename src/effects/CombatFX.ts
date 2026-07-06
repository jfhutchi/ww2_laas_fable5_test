/**
 * Combat visual effects, all procedural: tracer lines, muzzle flashes,
 * explosions (flash + debris + smoke), ricochet sparks, scorch decals,
 * persistent wreck/building fires with rising smoke columns, and ambient
 * battle-damage smoke from the world's ruined buildings.
 *
 * Built on three pooled instanced billboards (flash/smoke/debris) plus a
 * dynamic line buffer for tracers — a handful of draw calls total.
 */

import {
  AdditiveBlending,
  BufferGeometry,
  CanvasTexture,
  Color,
  DynamicDrawUsage,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  BoxGeometry,
  PerspectiveCamera,
  PlaneGeometry,
  Quaternion,
  RingGeometry,
  Scene,
  Vector3,
} from 'three';
import type { EventBus } from '../core/EventBus.ts';
import type { Ground } from '../world/Ground.ts';
import type { SmokeSourceSpec } from '../world/WorldTypes.ts';
import { Rng } from '../core/Random.ts';

const _UP = new Vector3(0, 1, 0);

interface Particle {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  ttl: number;
  size: number;
  grow: number;
  r: number;
  g: number;
  b: number;
  fade: number;
}

interface Tracer {
  x0: number;
  y0: number;
  z0: number;
  x1: number;
  y1: number;
  z1: number;
  life: number;
}

interface FireSource {
  x: number;
  y: number;
  z: number;
  strength: number;
  smokeAcc: number;
  flameAcc: number;
  /** 0 = forever (ambient building fires). */
  ttl: number;
}

const MAX_SMOKE = 480;
const MAX_FLASH = 64;
const MAX_DEBRIS = 128;
const MAX_TRACERS = 96;
const MAX_DECALS = 48;

function radialTexture(soft: boolean): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext('2d');
  if (ctx) {
    const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 62);
    if (soft) {
      g.addColorStop(0, 'rgba(255,255,255,0.85)');
      g.addColorStop(0.45, 'rgba(255,255,255,0.4)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
    } else {
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(0.25, 'rgba(255,255,255,0.9)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
    }
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
  }
  return new CanvasTexture(c);
}

export class CombatFX {
  private root = new Group();
  private smoke: Particle[] = [];
  private flash: Particle[] = [];
  private debris: Particle[] = [];
  private tracers: Tracer[] = [];
  private fires: FireSource[] = [];
  private smokeMesh: InstancedMesh;
  private flashMesh: InstancedMesh;
  private debrisMesh: InstancedMesh;
  private tracerLines: LineSegments;
  private decals: Mesh[] = [];
  private decalIdx = 0;
  private rng = new Rng(0x5f0f);
  private m = new Matrix4();
  private q = new Quaternion();
  private p = new Vector3();
  private s = new Vector3();
  private camQ = new Quaternion();
  private color = new Color();
  private unsubs: (() => void)[] = [];

  constructor(
    scene: Scene,
    bus: EventBus,
    private ground: Ground,
  ) {
    scene.add(this.root);
    this.root.name = 'combat-fx';

    const softTex = radialTexture(true);
    const hardTex = radialTexture(false);

    const quad = new PlaneGeometry(1, 1);
    const smokeMat = new MeshBasicMaterial({
      map: softTex,
      transparent: true,
      opacity: 0.34,
      depthWrite: false,
      fog: true,
    });
    smokeMat.color = new Color(1, 1, 1);
    this.smokeMesh = new InstancedMesh(quad, smokeMat, MAX_SMOKE);
    this.smokeMesh.frustumCulled = false;
    this.smokeMesh.renderOrder = 20;
    this.smokeMesh.count = 0;
    this.root.add(this.smokeMesh);

    const flashMat = new MeshBasicMaterial({
      map: hardTex,
      transparent: true,
      opacity: 0.9,
      blending: AdditiveBlending,
      depthWrite: false,
      fog: false,
    });
    this.flashMesh = new InstancedMesh(quad, flashMat, MAX_FLASH);
    this.flashMesh.frustumCulled = false;
    this.flashMesh.renderOrder = 22;
    this.flashMesh.count = 0;
    this.root.add(this.flashMesh);

    const debrisGeo = new BoxGeometry(0.16, 0.16, 0.16);
    const debrisMat = new MeshStandardMaterial({ color: new Color(0.16, 0.14, 0.12), roughness: 1 });
    this.debrisMesh = new InstancedMesh(debrisGeo, debrisMat, MAX_DEBRIS);
    this.debrisMesh.frustumCulled = false;
    this.debrisMesh.castShadow = false;
    this.debrisMesh.count = 0;
    this.root.add(this.debrisMesh);

    const tracerGeo = new BufferGeometry();
    tracerGeo.setAttribute('position', new Float32BufferAttribute(new Float32Array(MAX_TRACERS * 6), 3));
    (tracerGeo.attributes['position'] as Float32BufferAttribute).setUsage(DynamicDrawUsage);
    const tracerMat = new LineBasicMaterial({
      color: new Color(1.0, 0.82, 0.4),
      transparent: true,
      opacity: 0.85,
      blending: AdditiveBlending,
      depthWrite: false,
    });
    this.tracerLines = new LineSegments(tracerGeo, tracerMat);
    this.tracerLines.frustumCulled = false;
    this.tracerLines.renderOrder = 21;
    this.root.add(this.tracerLines);

    // scorch decal pool
    const decalGeo = new RingGeometry(0.02, 1, 20);
    decalGeo.rotateX(-Math.PI / 2);
    for (let i = 0; i < MAX_DECALS; i++) {
      const mat = new MeshBasicMaterial({
        map: softTex,
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
        color: new Color(0.06, 0.055, 0.05),
      });
      const d = new Mesh(decalGeo, mat);
      d.visible = false;
      d.renderOrder = 4;
      this.root.add(d);
      this.decals.push(d);
    }

    // ---- event wiring
    this.unsubs.push(
      bus.on('combat:shot', (e) => {
        this.spawnMuzzleFlash(e.x, e.y, e.z, e.weapon);
        if (e.weapon === 'mg' || e.weapon === 'rifle') {
          // short tracer burst forward is added by hit/near-miss events
        }
      }),
      bus.on('combat:hit', (e) => {
        if (e.kind === 'bullets' || e.kind === 'near-miss') {
          this.spawnImpactDust(e.x, e.y, e.z, 0.5);
        }
      }),
      bus.on('combat:penetrated', (e) => this.spawnSparks(e.x, e.y, e.z, 1)),
      bus.on('combat:ricochet', (e) => this.spawnSparks(e.x, e.y, e.z, 0.6)),
      bus.on('combat:explosion', (e) => this.spawnExplosion(e.x, e.y, e.z, e.radius, e.kind)),
      bus.on('unit:destroyed', (e) => {
        if (e.type === 'sherman' || e.type === 'stug' || e.type === 'panzer4') {
          this.fires.push({ x: e.x, y: e.y + 1.2, z: e.z, strength: 0.9, smokeAcc: 0, flameAcc: 0, ttl: 0 });
        }
      }),
    );
  }

  /** Ambient smoke columns from the world's damaged buildings. */
  addAmbientSources(sources: readonly SmokeSourceSpec[]): void {
    for (const s of sources) {
      this.fires.push({
        x: s.x,
        y: this.ground.height(s.x, s.z) + 4,
        z: s.z,
        strength: Math.min(1.3, s.strength * 1.05),
        smokeAcc: 0,
        flameAcc: 0,
        ttl: 0,
      });
    }
  }

  /** Visible shell tracer — called per projectile per frame by App. */
  traceShell(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): void {
    this.tracers.push({ x0, y0, z0, x1, y1, z1, life: 0.12 });
  }

  /** Rolling dust kicked up behind a moving vehicle. */
  vehicleDust(x: number, y: number, z: number, yaw: number, speedFrac: number): void {
    if (this.smoke.length > MAX_SMOKE - 8) return;
    this.smoke.push({
      x: x - Math.cos(yaw) * 2.4 + this.rng.range(-0.9, 0.9),
      y: y + 0.35,
      z: z - Math.sin(yaw) * 2.4 + this.rng.range(-0.9, 0.9),
      vx: this.rng.range(-0.5, 0.5) - Math.cos(yaw) * 0.8,
      vy: this.rng.range(0.35, 0.9),
      vz: this.rng.range(-0.5, 0.5) - Math.sin(yaw) * 0.8,
      life: 0,
      ttl: this.rng.range(1.2, 2.4) * (0.5 + speedFrac),
      size: this.rng.range(0.9, 1.7),
      grow: 1.4,
      r: 0.58, g: 0.52, b: 0.42,
      fade: 1,
    });
  }

  /** Persistent track impressions dropped under vehicle tracks. */
  private trackMesh: InstancedMesh | null = null;
  private trackIdx = 0;
  private trackCount = 0;
  trackMark(x: number, y: number, z: number, yaw: number): void {
    if (!this.trackMesh) {
      const quad = new PlaneGeometry(2.9, 1.6);
      quad.rotateX(-Math.PI / 2);
      const mat = new MeshBasicMaterial({
        color: new Color(0.16, 0.145, 0.12),
        transparent: true,
        opacity: 0.30,
        depthWrite: false,
      });
      this.trackMesh = new InstancedMesh(quad, mat, 384);
      this.trackMesh.frustumCulled = false;
      this.trackMesh.renderOrder = 3;
      this.trackMesh.count = 0;
      this.root.add(this.trackMesh);
    }
    this.p.set(x, y + 0.045, z);
    this.q.setFromAxisAngle(_UP, -yaw);
    this.s.set(1, 1, 1);
    this.m.compose(this.p, this.q, this.s);
    this.trackMesh.setMatrixAt(this.trackIdx % 384, this.m);
    this.trackIdx++;
    this.trackCount = Math.min(384, this.trackCount + 1);
    this.trackMesh.count = this.trackCount;
    this.trackMesh.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    for (const u of this.unsubs) u();
    this.root.removeFromParent();
  }

  // ------------------------------------------------------------- spawners

  private spawnMuzzleFlash(x: number, y: number, z: number, weapon: string): void {
    const big = weapon === 'cannon';
    this.flash.push({
      x, y, z,
      vx: 0, vy: 0, vz: 0,
      life: 0, ttl: big ? 0.09 : 0.05,
      size: big ? 3.4 : 1.1,
      grow: big ? 18 : 6,
      r: 1, g: 0.85, b: 0.55,
      fade: 1,
    });
    if (big) {
      // cannon smoke puff
      for (let i = 0; i < 4; i++) {
        this.smoke.push({
          x: x + this.rng.range(-0.4, 0.4),
          y: y + this.rng.range(-0.2, 0.4),
          z: z + this.rng.range(-0.4, 0.4),
          vx: this.rng.range(-0.8, 0.8),
          vy: this.rng.range(0.6, 1.6),
          vz: this.rng.range(-0.8, 0.8),
          life: 0,
          ttl: this.rng.range(1.2, 2.2),
          size: this.rng.range(1, 1.8),
          grow: 1.6,
          r: 0.75, g: 0.73, b: 0.68,
          fade: 1,
        });
      }
    }
  }

  private spawnSparks(x: number, y: number, z: number, strength: number): void {
    this.flash.push({
      x, y, z, vx: 0, vy: 0, vz: 0,
      life: 0, ttl: 0.07, size: 1.4 * strength, grow: 8,
      r: 1, g: 0.9, b: 0.7, fade: 1,
    });
    for (let i = 0; i < 5 * strength; i++) {
      this.debris.push({
        x, y, z,
        vx: this.rng.range(-6, 6),
        vy: this.rng.range(2, 8),
        vz: this.rng.range(-6, 6),
        life: 0, ttl: this.rng.range(0.4, 0.9),
        size: 0.5, grow: 0, r: 0.2, g: 0.18, b: 0.15, fade: 1,
      });
    }
  }

  private spawnImpactDust(x: number, y: number, z: number, strength: number): void {
    for (let i = 0; i < 2; i++) {
      this.smoke.push({
        x: x + this.rng.range(-0.5, 0.5),
        y,
        z: z + this.rng.range(-0.5, 0.5),
        vx: this.rng.range(-0.5, 0.5),
        vy: this.rng.range(0.4, 1),
        vz: this.rng.range(-0.5, 0.5),
        life: 0,
        ttl: this.rng.range(0.5, 1),
        size: 0.6 * strength + 0.3,
        grow: 1.2,
        r: 0.62, g: 0.56, b: 0.45,
        fade: 1,
      });
    }
  }

  private spawnExplosion(x: number, y: number, z: number, radius: number, kind: string): void {
    // core flash
    this.flash.push({
      x, y: y + 0.6, z, vx: 0, vy: 0, vz: 0,
      life: 0, ttl: 0.14, size: radius * 1.6, grow: radius * 10,
      r: 1, g: 0.78, b: 0.42, fade: 1,
    });
    // smoke plume
    const n = Math.min(16, Math.round(radius * 3));
    for (let i = 0; i < n; i++) {
      this.smoke.push({
        x: x + this.rng.range(-radius * 0.4, radius * 0.4),
        y: y + this.rng.range(0, radius * 0.3),
        z: z + this.rng.range(-radius * 0.4, radius * 0.4),
        vx: this.rng.range(-1.4, 1.4),
        vy: this.rng.range(1.5, 3.6),
        vz: this.rng.range(-1.4, 1.4),
        life: 0,
        ttl: this.rng.range(1.6, 3.4),
        size: this.rng.range(0.8, 1.6) * Math.max(1, radius * 0.4),
        grow: 2.2,
        r: 0.28, g: 0.26, b: 0.24,
        fade: 1,
      });
    }
    // dirt/debris
    const nd = Math.min(14, Math.round(radius * 2.5));
    for (let i = 0; i < nd; i++) {
      this.debris.push({
        x, y: y + 0.3, z,
        vx: this.rng.range(-8, 8),
        vy: this.rng.range(4, 13),
        vz: this.rng.range(-8, 8),
        life: 0, ttl: this.rng.range(0.7, 1.6),
        size: this.rng.range(0.6, 1.6), grow: 0,
        r: 0.2, g: 0.17, b: 0.13, fade: 1,
      });
    }
    // scorch decal on ground explosions
    if (kind === 'ground' || kind === 'vehicle') {
      const d = this.decals[this.decalIdx % MAX_DECALS];
      this.decalIdx++;
      if (d) {
        d.visible = true;
        d.position.set(x, this.ground.height(x, z) + 0.06, z);
        const s = Math.max(1.4, radius * 0.9);
        d.scale.set(s, 1, s);
      }
    }
  }

  // --------------------------------------------------------------- update

  update(dt: number, camera: PerspectiveCamera): void {
    this.camQ.copy(camera.quaternion);

    // fires emit smoke + flame flashes
    for (let i = this.fires.length - 1; i >= 0; i--) {
      const f = this.fires[i];
      if (!f) continue;
      if (f.ttl > 0) {
        f.ttl -= dt;
        if (f.ttl <= 0) {
          this.fires.splice(i, 1);
          continue;
        }
      }
      f.smokeAcc += dt * (1.8 + f.strength * 2.6);
      while (f.smokeAcc >= 1) {
        f.smokeAcc -= 1;
        if (this.smoke.length < MAX_SMOKE - 4) {
          this.smoke.push({
            x: f.x + this.rng.range(-1, 1) * f.strength,
            y: f.y,
            z: f.z + this.rng.range(-1, 1) * f.strength,
            vx: this.rng.range(-0.2, 0.7), // light easterly drift
            vy: this.rng.range(2.4, 4.4),
            vz: this.rng.range(-0.35, 0.35),
            life: 0,
            ttl: this.rng.range(7, 13),
            size: this.rng.range(2.2, 4.2) * (0.6 + f.strength),
            grow: 2.1,
            r: 0.15, g: 0.14, b: 0.13,
            fade: 0.8,
          });
        }
      }
      f.flameAcc += dt * (3 + f.strength * 5);
      while (f.flameAcc >= 1) {
        f.flameAcc -= 1;
        if (this.flash.length < MAX_FLASH - 2 && f.strength > 0.5) {
          this.flash.push({
            x: f.x + this.rng.range(-0.7, 0.7),
            y: f.y - 0.6 + this.rng.range(0, 0.6),
            z: f.z + this.rng.range(-0.7, 0.7),
            vx: 0, vy: 2.2, vz: 0,
            life: 0, ttl: this.rng.range(0.18, 0.4),
            size: this.rng.range(0.7, 1.6), grow: 0.4,
            r: 1, g: 0.55, b: 0.18, fade: 1,
          });
        }
      }
    }

    this.integrate(this.smoke, dt, MAX_SMOKE);
    this.integrate(this.flash, dt, MAX_FLASH);
    this.integrate(this.debris, dt, MAX_DEBRIS, true);

    // write instances
    this.writeBillboards(this.smokeMesh, this.smoke, true);
    this.writeBillboards(this.flashMesh, this.flash, true);
    this.writeDebris();

    // tracers
    const posAttr = this.tracerLines.geometry.attributes['position'] as Float32BufferAttribute;
    let ti = 0;
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i];
      if (!t) continue;
      t.life -= dt;
      if (t.life <= 0) {
        this.tracers.splice(i, 1);
        continue;
      }
      if (ti < MAX_TRACERS) {
        posAttr.setXYZ(ti * 2, t.x0, t.y0, t.z0);
        posAttr.setXYZ(ti * 2 + 1, t.x1, t.y1, t.z1);
        ti++;
      }
    }
    this.tracerLines.geometry.setDrawRange(0, ti * 2);
    posAttr.needsUpdate = true;
  }

  private integrate(list: Particle[], dt: number, max: number, gravity = false): void {
    while (list.length > max) list.shift();
    for (let i = list.length - 1; i >= 0; i--) {
      const pt = list[i];
      if (!pt) continue;
      pt.life += dt;
      if (pt.life >= pt.ttl) {
        list.splice(i, 1);
        continue;
      }
      if (gravity) pt.vy -= 22 * dt;
      pt.x += pt.vx * dt;
      pt.y += pt.vy * dt;
      pt.z += pt.vz * dt;
      pt.size += pt.grow * dt;
      if (gravity && pt.y < this.ground.height(pt.x, pt.z)) {
        pt.ttl = pt.life; // landed
      }
    }
  }

  private writeBillboards(mesh: InstancedMesh, list: Particle[], fadeByLife: boolean): void {
    const cap = mesh.instanceMatrix.count;
    let n = 0;
    for (const pt of list) {
      if (n >= cap) break;
      const frac = pt.life / pt.ttl;
      const scale = pt.size * (fadeByLife ? 0.6 + frac * 0.9 : 1);
      this.p.set(pt.x, pt.y, pt.z);
      this.s.setScalar(Math.max(0.01, scale * (frac > 0.75 ? (1 - frac) * 4 : 1)));
      this.m.compose(this.p, this.camQ, this.s);
      mesh.setMatrixAt(n, this.m);
      this.color.setRGB(pt.r, pt.g, pt.b);
      mesh.setColorAt(n, this.color);
      n++;
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }

  private writeDebris(): void {
    let n = 0;
    for (const pt of this.debris) {
      if (n >= MAX_DEBRIS) break;
      this.p.set(pt.x, pt.y, pt.z);
      this.q.setFromAxisAngle(this.p.clone().normalize(), pt.life * 7);
      this.s.setScalar(pt.size);
      this.m.compose(this.p, this.q, this.s);
      this.debrisMesh.setMatrixAt(n, this.m);
      n++;
    }
    this.debrisMesh.count = n;
    this.debrisMesh.instanceMatrix.needsUpdate = true;
  }
}
