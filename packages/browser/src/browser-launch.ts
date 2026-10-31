import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { BrowserContext } from 'playwright-core';
import { BrowserUnavailableError, isDeadBrowserError } from './browser-errors.js';
import { browserChromiumInstallHint, classifyBrowserLaunchError } from './install-status.js';

export type BrowserPersistentLaunchOptions = {
  headless: boolean;
  viewport: { width: number; height: number };
  deviceScaleFactor?: number;
  userAgent?: string;
  args?: string[];
  channel?: string;
  executablePath?: string;
  ignoreDefaultArgs?: string[] | boolean;
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
  channel?: string;
  executablePath?: string;
  ignoreDefaultArgs?: string[] | boolean;
  launchPersistentContext: BrowserLaunchPersistentContext;
};

export function defaultDesktopUserAgent(platform: NodeJS.Platform = process.platform): string {
  if (platform === 'darwin') {
    return 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
  }
  if (platform === 'win32') {
    return 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
  }
  return 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
}

export const DEFAULT_STEALTH_CHROMIUM_ARGS = [
  '--disable-blink-features=AutomationControlled',
] as const;

export const DEFAULT_STEALTH_IGNORE_DEFAULT_ARGS = [
  '--enable-automation',
] as const;

export function hasSystemChrome(): boolean {
  if (process.platform === 'darwin') {
    const macPaths = [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      join(homedir(), 'Applications/Google Chrome.app/Contents/MacOS/Google Chrome'),
    ];
    return macPaths.some((p) => existsSync(p));
  }
  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA ?? '';
    const winPaths = [
      localAppData ? join(localAppData, 'Google/Chrome/Application/chrome.exe') : '',
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    ].filter(Boolean);
    return winPaths.some((p) => existsSync(p));
  }
  if (process.platform === 'linux') {
    const linuxPaths = [
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
    ];
    return linuxPaths.some((p) => existsSync(p));
  }
  return false;
}

export function defaultLaunchPersistentContext(
  userDataDir: string,
  launchOptions: BrowserPersistentLaunchOptions,
): Promise<BrowserContext> {
  return import('playwright-core').then(({ chromium }) => {
    let channel = launchOptions.channel;
    let executablePath = launchOptions.executablePath;
    if (channel === undefined && executablePath === undefined) {
      if (hasSystemChrome()) {
        channel = 'chrome';
      } else {
        try {
          const resolved = chromium.executablePath();
          if (resolved && existsSync(resolved)) {
            executablePath = resolved;
          }
        } catch {
          // Fall back to Playwright's default resolution
        }
      }
    }
    return chromium.launchPersistentContext(userDataDir, {
      ...launchOptions,
      ...(channel !== undefined ? { channel } : {}),
      ...(executablePath !== undefined ? { executablePath } : {}),
    });
  });
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
  for (const flag of DEFAULT_STEALTH_CHROMIUM_ARGS) {
    if (!args.includes(flag)) {
      args.push(flag);
    }
  }
  const ignoreDefaultArgs =
    input.ignoreDefaultArgs !== undefined
      ? input.ignoreDefaultArgs
      : [...DEFAULT_STEALTH_IGNORE_DEFAULT_ARGS];
  const userAgent = input.userAgent ?? defaultDesktopUserAgent();
  try {
    return await input.launchPersistentContext(input.profileDir, {
      headless: input.headless,
      viewport: input.viewport,
      ...(input.deviceScaleFactor !== undefined
        ? { deviceScaleFactor: input.deviceScaleFactor }
        : {}),
      userAgent,
      ...(args.length > 0 ? { args } : {}),
      ...(input.channel !== undefined ? { channel: input.channel } : {}),
      ...(input.executablePath !== undefined ? { executablePath: input.executablePath } : {}),
      ...(ignoreDefaultArgs !== undefined ? { ignoreDefaultArgs } : {}),
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
