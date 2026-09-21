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
    /**
     * 2026-09-12 事故：不设上限时 vitest 按 CPU 核数开 worker（本机 10 个），
     * 每个 jsdom worker 实测 0.5-1.5 GB，叠上并发 tsc 后 24 GB 内存被打满，
     * 内核在 11:53 触发 out-of-application-memory。这是全仓最大的套件，
     * 也是 `pnpm --dir apps/desktop test` 绕过根脚本 --workspace-concurrency
     * 的那条路径，上限必须写在这里才拦得住。
     *
     * 保持 fork 隔离，并给每个 worker 设置堆上限。Vitest 会在文件
     * 完成后回收 worker，但单个泄漏文件不能因此把整台机器吃光。
     */
    maxWorkers: 2,
    minWorkers: 1,
    pool: 'forks',
    poolOptions: {
      forks: {
        isolate: true,
        execArgv: ['--max-old-space-size=1536'],
      },
    },
  },

  plugins: [react()],
  // Shiki loads grammars on demand inside the module worker.
  worker: { format: 'es' },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: serverHost,
    /**
     * 2026-09-21 事故（窗口全白）：Vite 给带 `?v=` 的预打包产物下发
     * `Cache-Control: max-age=31536000,immutable`，Tauri 的 WebKit webview 会照存一年。
     * 依赖重新预打包时 chunk 名会变（browserHash 只哈希 lockfile/config/依赖 id，
     * 所以改 workspace 包内容时哈希不变），缓存里的旧模块图便会去要已删除的 chunk，
     * 触发 ERR_FILE_NOT_FOUND_IN_OPTIMIZED_DEP_DIR，模块图断掉、窗口全白。
     * dev 从本地取包，禁掉缓存即可。Vite 的 send() 先写自己的 Cache-Control、
     * 之后才合并 server.headers，所以这里能覆盖掉 immutable。
     */
    headers: { 'Cache-Control': 'no-store' },
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
