import { defineConfig } from '@playwright/test';
import mobileConfig from './playwright.mobile.config';

const port = Number(process.env.PIWIN_CLASSIC_E2E_PORT ?? 1441);
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  ...mobileConfig,
  testMatch: /classic-layout\.spec\.ts/,
  use: { ...mobileConfig.use, baseURL },
  webServer: {
    command: `pnpm --dir ../mobile exec vite --port ${port} --strictPort --host 127.0.0.1`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
