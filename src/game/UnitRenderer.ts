/**
 * UnitRenderer: binds simulation UnitStates to 3D visuals every frame —
 * vehicle rigs (hull/turret/gun posing, terrain tilt, wreck states), gun
 * emplacements, instanced infantry soldiers with pose switching, selection
 * rings and path/intent lines. Enemy units are only shown when spotted
 * (fog of war) — except wrecks, which persist as terrain.
 */

import {
  Color,
  DoubleSide,
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  Line,
  LineBasicMaterial,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  RingGeometry,
  Scene,
  Vector3,
} from 'three';
import type { GameState } from './GameState.ts';
import { ARCHETYPES, type UnitState } from './Types.ts';
import type { Ground } from '../world/Ground.ts';
import { buildSherman, buildStuG, buildPanzer4, applyWreckLook, type VehicleRig } from '../assets/TankGenerator.ts';
import {
  buildMg42,
  buildPak40,
  buildSandbagArc,
  buildSoldierGeometry,
  MAT_SOLDIER,
  type GunProp,
  type SoldierPose,
  type SoldierSide,
} from '../assets/InfantryGenerator.ts';
import { angleDelta } from '../core/MathUtil.ts';
import { hash2D } from '../core/Random.ts';

const POOL_SIZE = 96;
const POSES: SoldierPose[] = ['stand', 'kneel', 'prone'];
const SIDES: SoldierSide[] = ['us', 'de'];

export class UnitRenderer {
  private root = new Group();
  private vehicles = new Map<number, { rig: VehicleRig; wrecked: boolean }>();
  private guns = new Map<number, { prop: GunProp; placed: boolean }>();
  private soldierPools = new Map<string, InstancedMesh>();
  private ringPool: Mesh[] = [];
  private pathLines: Line[] = [];
  private tmpM = new Matrix4();
  private tmpQ = new Quaternion();
  private tmpP = new Vector3();
  private tmpS = new Vector3(1, 1, 1);
  private up = new Vector3(0, 1, 0);
  private nrm = { x: 0, y: 1, z: 0 };

  constructor(
    scene: Scene,
    private gs: GameState,
    private ground: Ground,
  ) {
    scene.add(this.root);
    this.root.name = 'units';

    // instanced soldier pools per (side × pose)
    for (const side of SIDES) {
      for (const pose of POSES) {
        const geo = buildSoldierGeometry(side, pose, gs.model.seed ^ (side === 'us' ? 0x05 : 0xde) ^ pose.length);
        const im = new InstancedMesh(geo, MAT_SOLDIER, POOL_SIZE);
        im.castShadow = true;
        im.receiveShadow = false;
        im.frustumCulled = false;
        im.count = 0;
        // per-slot uniform-shade jitter breaks the clone-squad read; MUST be
        // seeded before first render or the pipeline compiles without the
        // instanceColor attribute (see TECHNICAL_NOTES.md)
        const tint = new Color();
        const poolSalt = (side === 'us' ? 0x51 : 0xa7) ^ pose.length;
        for (let i = 0; i < POOL_SIZE; i++) {
          const v = 0.92 + 0.16 * hash2D(i * 7 + 1, poolSalt, gs.model.seed ^ 0x501d);
          const warm = (hash2D(i * 13 + 5, poolSalt, gs.model.seed ^ 0x77aa) - 0.5) * 0.07;
          tint.setRGB(v * (1 + warm), v, v * (1 - warm));
          im.setColorAt(i, tint);
        }
        this.soldierPools.set(`${side}:${pose}`, im);
        this.root.add(im);
      }
    }

    // selection rings
    const ringGeo = new RingGeometry(0.86, 1, 28);
    ringGeo.rotateX(-Math.PI / 2);
    const ringMat = new MeshBasicMaterial({ color: new Color(0.62, 0.78, 0.36), transparent: true, opacity: 0.85, side: DoubleSide, depthWrite: false });
    for (let i = 0; i < 20; i++) {
      const ring = new Mesh(ringGeo, ringMat);
      ring.visible = false;
      ring.renderOrder = 5;
      this.root.add(ring);
      this.ringPool.push(ring);
    }

    // path lines
    const lineMat = new LineBasicMaterial({ color: new Color(0.65, 0.8, 0.4), transparent: true, opacity: 0.65 });
    for (let i = 0; i < 20; i++) {
      const line = new Line(new BufferGeometry(), lineMat);
      line.visible = false;
      line.renderOrder = 5;
      line.frustumCulled = false;
      this.root.add(line);
      this.pathLines.push(line);
    }

    // build initial unit visuals
    for (const u of gs.units) this.ensureUnit(u);
  }

  dispose(): void {
    this.root.removeFromParent();
  }

  private ensureUnit(u: UnitState): void {
    const arch = ARCHETYPES[u.cls];
    if (arch.kind === 'vehicle' && !this.vehicles.has(u.id)) {
      const rig =
        u.cls === 'sherman'
          ? buildSherman(this.gs.model.seed ^ u.id)
          : u.cls === 'stug'
            ? buildStuG(this.gs.model.seed ^ u.id)
            : buildPanzer4(this.gs.model.seed ^ u.id);
      this.vehicles.set(u.id, { rig, wrecked: false });
      this.root.add(rig.group);
    } else if (arch.kind === 'gun' && !this.guns.has(u.id)) {
      const prop = u.cls === 'at-gun' ? buildPak40(this.gs.model.seed ^ u.id) : buildMg42(this.gs.model.seed ^ u.id);
      this.guns.set(u.id, { prop, placed: false });
      this.root.add(prop.group);
      // defensive emplacement dressing
      const bags = buildSandbagArc(this.gs.model.seed ^ (u.id * 7));
      bags.position.set(u.x + Math.cos(u.yaw) * 1.2, this.ground.height(u.x, u.z), u.z + Math.sin(u.yaw) * 1.2);
      bags.rotation.y = -u.yaw;
      this.root.add(bags);
    }
  }

  update(selection: ReadonlySet<number>): void {
    // vehicles + guns
    for (const u of this.gs.units) {
      this.ensureUnit(u);
      const arch = ARCHETYPES[u.cls];

      if (arch.kind === 'vehicle') {
        const v = this.vehicles.get(u.id);
        if (!v) continue;
        const { rig } = v;
        const visible = u.side === 'player' || u.spotted || u.isWreck;
        rig.group.visible = visible;
        if (!visible) continue;

        // terrain-aligned pose: up from ground normal, forward from yaw
        this.ground.normal(u.x, u.z, this.nrm);
        this.up.set(this.nrm.x, this.nrm.y, this.nrm.z);
        const fwd = this.tmpP.set(Math.cos(u.yaw), 0, Math.sin(u.yaw));
        fwd.addScaledVector(this.up, -fwd.dot(this.up)).normalize();
        const right = new Vector3().crossVectors(this.up, fwd);
        this.tmpM.makeBasis(fwd, this.up, right.negate());
        this.tmpQ.setFromRotationMatrix(this.tmpM);
        rig.group.quaternion.copy(this.tmpQ);
        rig.group.position.set(u.x, u.y, u.z);

        // turret/gun pose (relative to hull)
        if (ARCHETYPES[u.cls].turretRate > 0) {
          rig.turret.rotation.y = -angleDelta(u.yaw, u.turretYaw);
        }

        // wreck state
        if (u.isWreck && !v.wrecked) {
          applyWreckLook(rig);
          v.wrecked = true;
        }
      } else if (arch.kind === 'gun') {
        const g = this.guns.get(u.id);
        if (!g) continue;
        const visible = u.side === 'player' || u.spotted || !u.alive;
        g.prop.group.visible = visible;
        if (visible) {
          g.prop.group.position.set(u.x, u.y, u.z);
          g.prop.group.rotation.y = -u.turretYaw;
          if (!u.alive) g.prop.group.rotation.z = 0.35; // knocked over
        }
      }
    }

    // infantry soldier instancing
    const counts = new Map<string, number>();
    for (const key of this.soldierPools.keys()) counts.set(key, 0);
    for (const u of this.gs.units) {
      const arch = ARCHETYPES[u.cls];
      const isCrewed = arch.kind === 'gun';
      if (arch.kind !== 'infantry' && !isCrewed) continue;
      if (!u.alive && !isCrewed) continue;
      const visible = u.side === 'player' || u.spotted;
      if (!visible) continue;
      const side: SoldierSide = u.side === 'player' ? 'us' : 'de';
      const pose: SoldierPose = !u.alive
        ? 'prone'
        : u.pinned
          ? 'prone'
          : u.vel > 0.25
            ? 'stand'
            : isCrewed || u.inCoverQuality > 0.3 || u.order.type === 'hold'
              ? 'kneel'
              : 'stand';
      const key = `${side}:${pose}`;
      const pool = this.soldierPools.get(key);
      if (!pool) continue;
      let idx = counts.get(key) ?? 0;
      for (const s of u.soldiers) {
        if (!s.alive || idx >= POOL_SIZE) continue;
        const y = this.ground.height(s.x, s.z);
        this.tmpP.set(s.x, y, s.z);
        this.tmpQ.setFromAxisAngle(this.up.set(0, 1, 0), -u.yaw);
        this.tmpM.compose(this.tmpP, this.tmpQ, this.tmpS.set(1, 1, 1));
        pool.setMatrixAt(idx, this.tmpM);
        idx++;
      }
      counts.set(key, idx);
    }
    for (const [key, pool] of this.soldierPools) {
      pool.count = counts.get(key) ?? 0;
      pool.instanceMatrix.needsUpdate = true;
    }

    // selection rings + path lines
    let ringIdx = 0;
    let lineIdx = 0;
    for (const id of selection) {
      const u = this.gs.byId.get(id);
      if (!u || !u.alive) continue;
      const ring = this.ringPool[ringIdx++];
      if (ring) {
        const r = ARCHETYPES[u.cls].radius * 1.35;
        ring.visible = true;
        ring.scale.set(r, 1, r);
        ring.position.set(u.x, u.y + 0.15, u.z);
      }
      if (u.path && u.pathIndex < u.path.length) {
        const line = this.pathLines[lineIdx++];
        if (line) {
          const pts: number[] = [u.x, u.y + 0.4, u.z];
          for (let i = u.pathIndex; i < u.path.length; i++) {
            const p = u.path[i];
            if (!p) continue;
            pts.push(p.x, this.ground.height(p.x, p.z) + 0.4, p.z);
          }
          line.geometry.setAttribute('position', new Float32BufferAttribute(pts, 3));
          line.geometry.attributes['position']!.needsUpdate = true;
          line.visible = true;
        }
      }
    }
    for (let i = ringIdx; i < this.ringPool.length; i++) {
      const r = this.ringPool[i];
      if (r) r.visible = false;
    }
    for (let i = lineIdx; i < this.pathLines.length; i++) {
      const l = this.pathLines[i];
      if (l) l.visible = false;
    }
  }
}
