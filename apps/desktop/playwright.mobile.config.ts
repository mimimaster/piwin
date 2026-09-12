import { defineConfig, devices } from '@playwright/test';
import desktopConfig from './playwright.config';

const port = Number(process.env.PIWIN_E2E_PORT ?? 1421);
const baseURL = process.env.PIWIN_E2E_BASE_URL ?? `http://127.0.0.1:${port}`;

export default defineConfig({
  ...desktopConfig,
  testDir: './e2e',
  testMatch: /viewport-responsive\.spec\.ts/,
  use: {
    ...desktopConfig.use,
    baseURL,
  },
  projects: [
    { name: 'mobile-chrome', use: { ...devices['Pixel 7'] } },
    { name: 'mobile-webkit', use: { ...devices['iPhone 13'] } },
  ],
  webServer: desktopConfig.webServer
    ? {
        ...desktopConfig.webServer,
        command: `VITE_PIWIN_E2E_FIXTURES=true pnpm exec vite --port ${port} --strictPort --host 127.0.0.1`,
        url: baseURL,
      }
    : undefined,
});
