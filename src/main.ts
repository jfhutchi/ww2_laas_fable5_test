/**
 * Operation Crossroads — entry point.
 * WebGPU-only boot: probe the adapter, fail loudly with diagnostics if
 * unsupported, otherwise hand off to the App conductor.
 */

import '@fontsource/barlow-condensed/latin-400.css';
import '@fontsource/barlow-condensed/latin-600.css';
import '@fontsource/barlow-condensed/latin-700.css';
import '@fontsource/ibm-plex-mono/latin-400.css';
import '@fontsource/ibm-plex-mono/latin-600.css';
import './ui/styles.css';
import { installHooks, reportFatal, reportProgress } from './app/Hooks.ts';
import { parseConfig } from './app/Config.ts';
import { probeWebGPU, formatDiagnostics, showFatalScreen } from './app/Diagnostics.ts';
import { App } from './app/App.ts';

const hooks = installHooks();

window.addEventListener('error', (e) => {
  const msg = `error: ${e.message} @ ${e.filename}:${e.lineno}`;
  hooks.stats?.errors.push(msg);
  if (!hooks.ready) reportFatal(hooks, e.error ?? e.message);
});
window.addEventListener('unhandledrejection', (e) => {
  const msg = `unhandledrejection: ${String(e.reason)}`;
  hooks.stats?.errors.push(msg);
  if (!hooks.ready) reportFatal(hooks, e.reason);
});

async function boot(): Promise<void> {
  const config = parseConfig();
  reportProgress(hooks, 0.02, 'probing WebGPU');

  const diag = await probeWebGPU();
  if (!diag.gpuPresent || !diag.adapterPresent) {
    const detail = formatDiagnostics(diag);
    showFatalScreen('WEBGPU NOT AVAILABLE', detail);
    hooks.error = `WebGPU unavailable.\n${detail}`;
    return;
  }
  // eslint-disable-next-line no-console
  console.log(`[oc] WebGPU adapter: ${diag.vendor} ${diag.architecture} ${diag.description}`.trim());

  const app = new App(config, hooks);
  await app.init();

  // Wait a couple of real frames before declaring ready so shaders compile
  // and the first image is actually on screen.
  await new Promise<void>((resolve) => {
    const settle = hooks.settle;
    if (settle) void settle(3).then(resolve);
    else resolve();
  });

  const overlay = document.getElementById('boot-overlay');
  if (overlay) overlay.style.display = 'none';
  hooks.ready = true;
  reportProgress(hooks, 1, 'ready');
  // eslint-disable-next-line no-console
  console.log(`[oc] ready — seed=${config.seed} preset=${config.preset} mode=${config.mode}`);
}

boot().catch((err: unknown) => {
  reportFatal(hooks, err);
  showFatalScreen('BOOT FAILURE', err instanceof Error ? `${err.message}\n\n${err.stack ?? ''}` : String(err));
});
