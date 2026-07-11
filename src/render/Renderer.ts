/**
 * WebGPURenderer wrapper. WebGPU-only: construction is preceded by an adapter
 * probe (app/Diagnostics.ts) and followed by a backend assertion so a silent
 * three.js WebGL fallback can never slip through.
 */

import { ACESFilmicToneMapping, SRGBColorSpace, PCFSoftShadowMap } from 'three';
import { WebGPURenderer } from 'three/webgpu';
import type { GraphicsPreset } from '../app/Config.ts';

export interface RendererStats {
  drawCalls: number;
  triangles: number;
  points: number;
  lines: number;
  geometries: number;
  textures: number;
}

export class Renderer {
  readonly three: WebGPURenderer;
  readonly canvas: HTMLCanvasElement;

  constructor(preset: GraphicsPreset) {
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'game-canvas';
    this.three = new WebGPURenderer({
      canvas: this.canvas,
      // high/ultra use TAA in the post stack (TRAANode requires MSAA off and
      // PassNode inherits renderer samples); low renders direct with MSAA
      antialias: preset === 'low',
      forceWebGL: false,
    });
    this.three.toneMapping = ACESFilmicToneMapping;
    this.three.toneMappingExposure = 1.08; // rebalance for the low golden-hour sun
    this.three.outputColorSpace = SRGBColorSpace;
    this.three.shadowMap.enabled = true;
    this.three.shadowMap.type = PCFSoftShadowMap;
  }

  async init(): Promise<void> {
    await this.three.init();
    const backend = (this.three as unknown as { backend?: { isWebGPUBackend?: boolean } }).backend;
    if (!backend?.isWebGPUBackend) {
      throw new Error(
        'three.js initialized a non-WebGPU backend. This build is WebGPU-only; refusing to continue.',
      );
    }
  }

  resize(width: number, height: number, pixelRatio: number): void {
    this.three.setPixelRatio(pixelRatio);
    this.three.setSize(width, height, false);
  }

  stats(): RendererStats {
    const info = this.three.info;
    return {
      drawCalls: info.render.calls,
      triangles: info.render.triangles,
      points: info.render.points,
      lines: info.render.lines,
      geometries: info.memory.geometries,
      textures: info.memory.textures,
    };
  }
}
