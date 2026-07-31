/**
 * Chromium install status for `piwin doctor`.
 *
 * `playwright-core` does not download browsers; the binary comes from
 * `pnpm --dir apps/desktop e2e:install` (`playwright install chromium`). This
 * helper resolves the expected executable and reports whether it is on disk so
 * tooling can surface an actionable install hint instead of a raw launch error.
 */
import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';

export type BrowserInstallStatus = {
  available: boolean;
  path?: string;
  hint?: string;
};

const INSTALL_HINT = 'Run: pnpm --dir apps/desktop e2e:install';

export function getBrowserInstallStatus(): BrowserInstallStatus {
  try {
    const executablePath = chromium.executablePath();
    if (existsSync(executablePath)) {
      return { available: true, path: executablePath };
    }
    return {
      available: false,
      path: executablePath,
      hint: INSTALL_HINT,
    };
  } catch (error) {
    return {
      available: false,
      hint: `Could not resolve the chromium executable (${error instanceof Error ? error.message : String(error)}). ${INSTALL_HINT}`,
    };
  }
}
