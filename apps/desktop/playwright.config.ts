import { defineConfig, devices } from '@playwright/test';

/**
 * Desktop UI e2e against Vite + in-browser HostClient mock.
 * Does not launch Tauri / Rust (see docs for local commands).
 *
 * Local:
 *   pnpm --dir apps/desktop e2e:install   # once
 *   pnpm e2e:desktop
 */
const port = Number(process.env.PIWIN_E2E_PORT ?? 1420);
const baseURL = process.env.PIWIN_E2E_BASE_URL ?? `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  timeout: 60_000,
  expect: {
    timeout: 10_000,
    toHaveScreenshot: {
      // Stable baselines for dark shell chrome; allow tiny antialiasing noise.
      maxDiffPixelRatio: 0.02,
      animations: 'disabled',
    },
  },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'off',
    ...devices['Desktop Chrome'],
  },
  webServer: {
    command: `pnpm exec vite --port ${port} --strictPort --host 127.0.0.1`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
