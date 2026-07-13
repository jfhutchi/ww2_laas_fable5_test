import assert from 'node:assert/strict';
import { ensureDevServer } from './launch.ts';

async function responds(): Promise<boolean> {
  try {
    const response = await fetch('http://localhost:5173/', { signal: AbortSignal.timeout(1000) });
    return response.ok;
  } catch {
    return false;
  }
}

if (await responds()) {
  console.log('launch regressions: SKIP (port 5173 already owned by the user)');
} else {
  const server = await ensureDevServer();
  assert.equal(await responds(), true, 'owned Vite server did not become reachable');
  server.stop();
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline && await responds()) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  assert.equal(await responds(), false, 'owned Vite server survived stop()');
  console.log('launch regressions: PASS');
}
