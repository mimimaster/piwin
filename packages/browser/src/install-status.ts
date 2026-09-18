/**
 * Chromium install status for `piwin doctor` and first-use download.
 *
 * `playwright-core` does not download browsers by itself. The Host cache is
 * `~/.piwin/playwright` (`PLAYWRIGHT_BROWSERS_PATH`). This helper resolves the
 * expected executable after that env is applied so doctor/UI can hint instead
 * of showing a raw Playwright launch error.
 */
import { existsSync } from 'node:fs';
import {
  DEFAULT_PLAYWRIGHT_CHROMIUM_VARIANT,
  resolvePlaywrightHeadlessShellExecutablePath,
  type PlaywrightChromiumVariant,
} from './playwright-chromium-variant.js';

export type BrowserInstallFailureReason = 'binary-missing' | 'profile-in-use' | 'startup-failed';

export type BrowserInstallStatus = {
  available: boolean;
  path?: string;
  hint?: string;
  reason?: BrowserInstallFailureReason;
};

export function browserChromiumInstallHint(): string {
  const destination = process.env.PLAYWRIGHT_BROWSERS_PATH?.trim() || '~/.piwin/playwright';
  return `Chromium downloads to ${destination} the first time the browser is used.`;
}

export async function getBrowserInstallStatus(options?: {
  variant?: PlaywrightChromiumVariant;
}): Promise<BrowserInstallStatus> {
  const variant = options?.variant ?? DEFAULT_PLAYWRIGHT_CHROMIUM_VARIANT;
  try {
    const executablePath = await resolveBrowserExecutablePath(variant);
    if (existsSync(executablePath)) {
      return { available: true, path: executablePath };
    }
    return {
      available: false,
      path: executablePath,
      reason: 'binary-missing',
      hint: browserChromiumInstallHint(),
    };
  } catch (error) {
    return {
      available: false,
      reason: 'binary-missing',
      hint: `Could not resolve the chromium executable (${error instanceof Error ? error.message : String(error)}). ${browserChromiumInstallHint()}`,
    };
  }
}

async function resolveBrowserExecutablePath(variant: PlaywrightChromiumVariant): Promise<string> {
  if (variant === 'chromium') {
    const { chromium } = await import('playwright-core');
    return chromium.executablePath();
  }
  const browsersPath = process.env.PLAYWRIGHT_BROWSERS_PATH?.trim();
  if (browsersPath === undefined || browsersPath.length === 0) {
    throw new Error('PLAYWRIGHT_BROWSERS_PATH is not set');
  }
  return resolvePlaywrightHeadlessShellExecutablePath(browsersPath);
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
