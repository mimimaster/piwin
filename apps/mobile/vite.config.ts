import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { injectLaunchSplash } from './launch-splash/inject-launch-splash.js';

const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'launch-splash/**/*.test.ts'],
  },
  plugins: [
    react(),
    { name: 'piwin-launch-splash', transformIndexHtml: (html) => injectLaunchSplash(html) },
  ],
  clearScreen: false,
  server: {
    port: 1421,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: 'ws',
          host,
          port: 1422,
        }
      : undefined,
  },
  envPrefix: ['VITE_', 'TAURI_'],
  build: {
    target: process.env.TAURI_ENV_PLATFORM === 'windows' ? 'chrome105' : 'safari13',
    minify: !process.env.TAURI_ENV_DEBUG ? 'esbuild' : false,
    sourcemap: Boolean(process.env.TAURI_ENV_DEBUG),
  },
});
