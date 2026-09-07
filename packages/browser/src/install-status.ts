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

export type BrowserInstallFailureReason = 'binary-missing' | 'profile-in-use' | 'startup-failed';

export type BrowserInstallStatus = {
  available: boolean;
  path?: string;
  hint?: string;
  reason?: BrowserInstallFailureReason;
};

const DEV_INSTALL_HINT = 'Run: pnpm --dir apps/desktop e2e:install';

function installHint(): string {
  if (typeof process.versions.electron === 'string' || process.env.PIWIN_PACKAGED === '1') {
    return 'Chromium is not bundled with this Host. Install a Playwright Chromium matching this runtime, or run from a developer checkout.';
  }
  return DEV_INSTALL_HINT;
}

export function getBrowserInstallStatus(): BrowserInstallStatus {
  try {
    const executablePath = chromium.executablePath();
    if (existsSync(executablePath)) {
      return { available: true, path: executablePath };
    }
    return {
      available: false,
      path: executablePath,
      reason: 'binary-missing',
      hint: installHint(),
    };
  } catch (error) {
    return {
      available: false,
      reason: 'binary-missing',
      hint: `Could not resolve the chromium executable (${error instanceof Error ? error.message : String(error)}). ${installHint()}`,
    };
  }
}

/** Classify a Playwright launch failure without deleting profiles or lock files. */
export function classifyBrowserLaunchError(error: unknown): BrowserInstallFailureReason {
  const message = error instanceof Error ? error.message : String(error);
  const lowered = message.toLowerCase();
  if (
    lowered.includes('process singleton') ||
    lowered.includes('profile is already in use') ||
    lowered.includes('singletonlock')
  ) {
    return 'profile-in-use';
  }
  if (
    lowered.includes('executable doesn\'t exist') ||
    lowered.includes('executable does not exist') ||
    (lowered.includes('failed to launch') && lowered.includes('chromium'))
  ) {
    return 'binary-missing';
  }
  return 'startup-failed';
}
