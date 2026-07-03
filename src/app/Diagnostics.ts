/**
 * WebGPU-only gate. Probes the adapter BEFORE constructing the renderer and
 * fails loudly with a full diagnostic screen if WebGPU is unavailable.
 * There is deliberately no WebGL fallback anywhere in this project.
 */

export interface GpuDiagnostics {
  userAgent: string;
  secureContext: boolean;
  gpuPresent: boolean;
  adapterPresent: boolean;
  vendor: string;
  architecture: string;
  device: string;
  description: string;
  features: string[];
  maxTextureDimension2D: number;
  maxBufferSize: number;
}

export async function probeWebGPU(): Promise<GpuDiagnostics> {
  const diag: GpuDiagnostics = {
    userAgent: navigator.userAgent,
    secureContext: window.isSecureContext,
    gpuPresent: false,
    adapterPresent: false,
    vendor: '',
    architecture: '',
    device: '',
    description: '',
    features: [],
    maxTextureDimension2D: 0,
    maxBufferSize: 0,
  };

  const gpu = navigator.gpu;
  if (!gpu) return diag;
  diag.gpuPresent = true;

  const adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) return diag;
  diag.adapterPresent = true;

  const info = adapter.info;
  diag.vendor = info.vendor;
  diag.architecture = info.architecture;
  diag.device = info.device;
  diag.description = info.description;
  diag.features = [...adapter.features].map(String).sort();
  diag.maxTextureDimension2D = adapter.limits.maxTextureDimension2D;
  diag.maxBufferSize = adapter.limits.maxBufferSize;
  return diag;
}

export function formatDiagnostics(d: GpuDiagnostics): string {
  return [
    `secureContext: ${d.secureContext}`,
    `navigator.gpu: ${d.gpuPresent ? 'present' : 'MISSING'}`,
    `adapter: ${d.adapterPresent ? 'present' : 'MISSING'}`,
    `vendor: ${d.vendor || 'n/a'}`,
    `architecture: ${d.architecture || 'n/a'}`,
    `device: ${d.device || 'n/a'} ${d.description || ''}`,
    `maxTextureDimension2D: ${d.maxTextureDimension2D}`,
    `maxBufferSize: ${d.maxBufferSize}`,
    `features: ${d.features.join(', ') || 'n/a'}`,
    `userAgent: ${d.userAgent}`,
  ].join('\n');
}

/** Replace the boot overlay with a fatal, unmissable diagnostics screen. */
export function showFatalScreen(title: string, detail: string): void {
  const overlay = document.getElementById('boot-overlay');
  if (!overlay) return;
  overlay.classList.add('fatal');
  overlay.style.display = 'flex';
  overlay.replaceChildren();
  const card = document.createElement('div');
  card.id = 'fatal-card';
  const h = document.createElement('div');
  h.id = 'fatal-title';
  h.textContent = title;
  const pre = document.createElement('pre');
  pre.id = 'fatal-detail';
  pre.textContent = detail;
  const hint = document.createElement('div');
  hint.id = 'fatal-hint';
  hint.textContent =
    'Operation Crossroads requires WebGPU. Use a current Chromium-based browser ' +
    '(Chrome/Edge 113+) on a machine with a supported GPU. There is no WebGL fallback.';
  card.append(h, pre, hint);
  overlay.append(card);
}
