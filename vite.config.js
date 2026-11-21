import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  base: './',
  server: {
    host: true,
    port: 5173,
  },
  build: {
    target: 'es2022',
    rollupOptions: {
      input: {
        main: resolve(rootDir, 'index.html'),
        hostDemo: resolve(rootDir, 'host-demo.html'),
        frontendDemo: resolve(rootDir, 'adapters/frontend/example-canvas.html'),
      },
    },
  },
});
