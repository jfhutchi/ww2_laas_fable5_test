import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 4096,
  },
  // three/webgpu + three/tsl are ESM subpath exports of the three package;
  // no special handling needed under Vite 6 with moduleResolution: bundler.
});
