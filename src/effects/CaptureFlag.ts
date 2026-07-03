/**
 * Capture-zone visual at the crossroads: flagpole with a cloth that waves
 * and recolors by capture state, plus a dashed ground ring marking the
 * zone radius — the in-world twin of the HUD capture panel.
 */

import {
  BufferAttribute,
  BufferGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  RingGeometry,
} from 'three';

const STATE_COLORS: Record<string, Color> = {
  Neutral: new Color(0.72, 0.7, 0.62),
  Capturing: new Color(0.55, 0.72, 0.38),
  Contested: new Color(0.85, 0.55, 0.25),
  Securing: new Color(0.62, 0.8, 0.42),
  Secured: new Color(0.5, 0.75, 0.35),
  'Enemy Recapturing': new Color(0.8, 0.32, 0.24),
};

export class CaptureFlag {
  readonly group = new Group();
  private cloth: Mesh;
  private clothGeo: BufferGeometry;
  private ringMat: MeshBasicMaterial;
  private clothMat: MeshStandardMaterial;
  private time = 0;
  private baseX: Float32Array;
  private baseY: Float32Array;

  constructor(x: number, groundY: number, z: number, radius: number) {
    this.group.name = 'capture-flag';
    this.group.position.set(x, groundY, z);

    // pole
    const pole = new Mesh(
      new CylinderGeometry(0.06, 0.09, 7.2, 8),
      new MeshStandardMaterial({ color: new Color(0.32, 0.28, 0.22), roughness: 0.9 }),
    );
    pole.position.y = 3.6;
    pole.castShadow = true;
    this.group.add(pole);

    // cloth: subdivided plane waving in code
    const w = 2.2;
    const h = 1.3;
    const segX = 8;
    const segY = 4;
    const positions: number[] = [];
    const indices: number[] = [];
    for (let j = 0; j <= segY; j++) {
      for (let i = 0; i <= segX; i++) {
        positions.push((i / segX) * w, (j / segY) * h, 0);
      }
    }
    for (let j = 0; j < segY; j++) {
      for (let i = 0; i < segX; i++) {
        const a = j * (segX + 1) + i;
        const b = a + 1;
        const c = a + segX + 1;
        const d = c + 1;
        indices.push(a, c, b, b, c, d);
      }
    }
    this.clothGeo = new BufferGeometry();
    this.clothGeo.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
    this.clothGeo.setIndex(indices);
    this.clothGeo.computeVertexNormals();
    this.baseX = new Float32Array(positions.filter((_, k) => k % 3 === 0));
    this.baseY = new Float32Array(positions.filter((_, k) => k % 3 === 1));
    this.clothMat = new MeshStandardMaterial({
      color: STATE_COLORS['Neutral'] ?? new Color(0.7, 0.7, 0.62),
      roughness: 0.85,
      side: DoubleSide,
    });
    this.cloth = new Mesh(this.clothGeo, this.clothMat);
    this.cloth.position.set(0.07, 5.7, 0);
    this.cloth.castShadow = true;
    this.group.add(this.cloth);

    // zone ring
    const ringGeo = new RingGeometry(radius - 0.5, radius, 64, 1);
    ringGeo.rotateX(-Math.PI / 2);
    this.ringMat = new MeshBasicMaterial({
      color: STATE_COLORS['Neutral'] ?? new Color(0.7, 0.7, 0.62),
      transparent: true,
      opacity: 0.4,
      depthWrite: false,
    });
    const ring = new Mesh(ringGeo, this.ringMat);
    ring.position.y = 0.12;
    ring.renderOrder = 4;
    this.group.add(ring);
  }

  update(dt: number, state: string, progress: number): void {
    this.time += dt;
    const target = STATE_COLORS[state] ?? STATE_COLORS['Neutral'];
    if (target) {
      this.clothMat.color.lerp(target, 0.06);
      this.ringMat.color.lerp(target, 0.06);
    }
    this.ringMat.opacity = state === 'Contested' ? 0.35 + 0.25 * Math.sin(this.time * 6) : 0.4;

    // wave the cloth
    const pos = this.clothGeo.attributes['position'];
    if (pos) {
      for (let i = 0; i < pos.count; i++) {
        const bx = this.baseX[i] ?? 0;
        const by = this.baseY[i] ?? 0;
        const t = bx / 2.2;
        pos.setZ(i, Math.sin(this.time * 5 + t * 5.5) * 0.16 * t + Math.sin(this.time * 2.3 + by * 3) * 0.05 * t);
      }
      pos.needsUpdate = true;
      this.clothGeo.computeVertexNormals();
    }
    void progress;
  }
}
