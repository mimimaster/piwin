import { defineConfig, devices } from '@playwright/test';
import desktopConfig from './playwright.config.js';

export default defineConfig({
  ...desktopConfig,
  testMatch: /(?:embedded-tui-layout|terminal-production)\.spec\.ts/,
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    // Desktop Tauri on macOS uses WebKit; exercise the same flex/fit loop there.
    { name: 'desktop-webkit', use: { ...devices['Desktop Safari'] } },
  ],
});
