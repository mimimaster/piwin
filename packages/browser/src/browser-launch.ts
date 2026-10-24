import type { BrowserContext } from 'playwright-core';
import { BrowserUnavailableError, isDeadBrowserError } from './browser-errors.js';
import { browserChromiumInstallHint, classifyBrowserLaunchError } from './install-status.js';

export type BrowserPersistentLaunchOptions = {
  headless: boolean;
  viewport: { width: number; height: number };
  deviceScaleFactor?: number;
  userAgent?: string;
  args?: string[];
};

export type BrowserLaunchPersistentContext = (
  userDataDir: string,
  options: BrowserPersistentLaunchOptions,
) => Promise<BrowserContext>;

export type BrowserChromiumLaunchInput = {
  profileDir: string;
  headless: boolean;
  viewport: { width: number; height: number };
  deviceScaleFactor?: number;
  userAgent?: string;
  args?: string[];
  launchPersistentContext: BrowserLaunchPersistentContext;
};

export function defaultLaunchPersistentContext(
  userDataDir: string,
  launchOptions: BrowserPersistentLaunchOptions,
): Promise<BrowserContext> {
  return import('playwright-core').then(({ chromium }) =>
    chromium.launchPersistentContext(userDataDir, launchOptions),
  );
}

export function launchTimeoutError(timeoutMs: number): BrowserUnavailableError {
  return new BrowserUnavailableError(`browser launch timed out after ${timeoutMs}ms`);
}

export async function closeQuietly(
  target: { close: () => Promise<unknown> } | undefined,
): Promise<void> {
  if (target === undefined) return;
  try {
    await target.close();
  } catch (error) {
    if (isDeadBrowserError(error)) return;
    console.warn('[browser] cleanup failed', error instanceof Error ? error.message : error);
  }
}

/**
 * Starts the owned Chromium with the Host's viewport and flags. A
 * device-scale-factor above 1 is passed as a Chromium flag too, unless the
 * caller already set one. Launch failures are classified so the shell can
 * show an install hint or a profile-in-use message instead of a raw error.
 */
export async function launchChromiumContext(
  input: BrowserChromiumLaunchInput,
): Promise<BrowserContext> {
  const scale = input.deviceScaleFactor ?? 1;
  const args: string[] = [...(input.args ?? [])];
  if (scale > 1 && !args.some((arg) => arg.startsWith('--force-device-scale-factor'))) {
    args.push(`--force-device-scale-factor=${scale}`);
  }
  try {
    return await input.launchPersistentContext(input.profileDir, {
      headless: input.headless,
      viewport: input.viewport,
      ...(input.deviceScaleFactor !== undefined
        ? { deviceScaleFactor: input.deviceScaleFactor }
        : {}),
      ...(input.userAgent !== undefined ? { userAgent: input.userAgent } : {}),
      ...(args.length > 0 ? { args } : {}),
    });
  } catch (error) {
    const reason = classifyBrowserLaunchError(error);
    throw new BrowserUnavailableError(
      reason === 'binary-missing'
        ? `headless Chromium could not be launched. ${browserChromiumInstallHint()}`
        : reason === 'profile-in-use'
          ? 'browser profile is already in use by another Chromium'
          : `headless Chromium failed to start (${error instanceof Error ? error.message : String(error)})`,
      { cause: error, reason },
    );
  }
}
