import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const remoteDevHost = process.env.TAURI_DEV_HOST;
const serverHost = remoteDevHost ?? '127.0.0.1';
const desktopRoot = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    exclude: ['e2e/**', 'node_modules/**'],
    setupFiles: ['./src/setupTests.ts'],
  },

  plugins: [react()],
  // Shiki loads grammars on demand inside the module worker.
  worker: { format: 'es' },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: serverHost,
    hmr: remoteDevHost
      ? {
          protocol: 'ws',
          host: remoteDevHost,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ['**/src-tauri/**'],
    },
  },
  envPrefix: ['VITE_', 'TAURI_'],
  build: {
    target: process.env.TAURI_ENV_PLATFORM === 'windows' ? 'chrome105' : 'safari13',
    minify: !process.env.TAURI_ENV_DEBUG ? 'esbuild' : false,
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
    rollupOptions: {
      input: {
        main: resolve(desktopRoot, 'index.html'),
        petOverlay: resolve(desktopRoot, 'pet-overlay.html'),
      },
    },
  },
});
