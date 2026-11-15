import { existsSync, readFileSync } from 'node:fs';
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

/**
 * Resolves the installed Chrome / Chromium major version by inspecting the
 * application bundle (macOS Info.plist) or target executable path.
 */
export function resolveChromeVersion(options?: {
  executablePath?: string;
  channel?: string;
}): string | undefined {
  if (process.platform === 'darwin') {
    const candidates = [
      options?.executablePath ? join(options.executablePath, '../../Info.plist') : '',
      '/Applications/Google Chrome.app/Contents/Info.plist',
      join(homedir(), 'Applications/Google Chrome.app/Contents/Info.plist'),
    ].filter(Boolean);
    for (const plistPath of candidates) {
      if (existsSync(plistPath)) {
        try {
          const content = readFileSync(plistPath, 'utf8');
          const match = content.match(/<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/);
          if (match?.[1]) {
            return match[1];
          }
        } catch {
          // ignore read failure
        }
      }
    }
  }
  return undefined;
}

export function defaultDesktopUserAgent(
  platform: NodeJS.Platform = process.platform,
  version?: string,
): string {
  const major = version !== undefined && version.trim() !== '' ? version.split('.')[0] : '156';
  if (platform === 'darwin') {
    return `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`;
  }
  if (platform === 'win32') {
    return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`;
  }
  return `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`;
}

export const DEFAULT_STEALTH_CHROMIUM_ARGS = [
  '--disable-blink-features=AutomationControlled',
] as const;

export const DEFAULT_STEALTH_IGNORE_DEFAULT_ARGS = [
  '--enable-automation',
  '--enable-unsafe-swiftshader',
] as const;

export function hasSystemChrome(platform: NodeJS.Platform = process.platform): boolean {
  if (platform === 'darwin') {
    const macPaths = [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      join(homedir(), 'Applications/Google Chrome.app/Contents/MacOS/Google Chrome'),
    ];
    return macPaths.some((p) => existsSync(p));
  }
  if (platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA ?? '';
    const winPaths = [
      localAppData ? join(localAppData, 'Google/Chrome/Application/chrome.exe') : '',
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    ].filter(Boolean);
    return winPaths.some((p) => existsSync(p));
  }
  if (platform === 'linux') {
    const linuxPaths = [
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
    ];
    return linuxPaths.some((p) => existsSync(p));
  }
  return false;
}

export type BrowserLaunchTarget = {
  channel?: string;
  executablePath?: string;
};

/**
 * Selects the default browser binary when neither `channel` nor `executablePath`
 * was explicitly configured.
 *
 * On macOS, headless `/Applications/Google Chrome.app` shares bundle identifier
 * `com.google.Chrome` with the user's primary browser. LaunchServices can promote
 * that headless process to Foreground and deliver system-wide `open https://...`
 * events (OAuth verification links, external URLs) into the invisible headless
 * session instead of the user's visible Chrome window. Headless macOS launches
 * therefore use Playwright's owned Chromium (`com.google.chrome.for.testing`).
 */
export function resolveDefaultBrowserLaunchTarget(input: {
  headless: boolean;
  channel?: string;
  executablePath?: string;
  platform?: NodeJS.Platform;
  hasInstalledSystemChrome?: boolean;
  resolvePlaywrightExecutable?: () => string | undefined;
}): BrowserLaunchTarget {
  if (input.channel !== undefined || input.executablePath !== undefined) {
    return {
      ...(input.channel !== undefined ? { channel: input.channel } : {}),
      ...(input.executablePath !== undefined ? { executablePath: input.executablePath } : {}),
    };
  }
  const platform = input.platform ?? process.platform;
  const allowSystemChrome = !(platform === 'darwin' && input.headless !== false);
  const systemChromeAvailable = input.hasInstalledSystemChrome ?? hasSystemChrome(platform);
  if (allowSystemChrome && systemChromeAvailable) {
    return { channel: 'chrome' };
  }
  try {
    const resolved = input.resolvePlaywrightExecutable?.();
    if (resolved) {
      return { executablePath: resolved };
    }
  } catch {
    // Fall back to Playwright's default resolution
  }
  return {};
}

export function defaultLaunchPersistentContext(
  userDataDir: string,
  launchOptions: BrowserPersistentLaunchOptions,
): Promise<BrowserContext> {
  return import('playwright-core').then(({ chromium }) => {
    const target = resolveDefaultBrowserLaunchTarget({
      headless: launchOptions.headless,
      ...(launchOptions.channel !== undefined ? { channel: launchOptions.channel } : {}),
      ...(launchOptions.executablePath !== undefined
        ? { executablePath: launchOptions.executablePath }
        : {}),
      resolvePlaywrightExecutable: () => {
        const resolved = chromium.executablePath();
        return resolved && existsSync(resolved) ? resolved : undefined;
      },
    });
    return chromium.launchPersistentContext(userDataDir, {
      ...launchOptions,
      ...(target.channel !== undefined ? { channel: target.channel } : {}),
      ...(target.executablePath !== undefined ? { executablePath: target.executablePath } : {}),
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
  const isHeadless = input.headless !== false;
  if (isHeadless && !args.some((arg) => arg.startsWith('--headless'))) {
    args.push('--headless=new');
  }
  const ignoreDefaultArgs =
    input.ignoreDefaultArgs !== undefined
      ? input.ignoreDefaultArgs
      : [...DEFAULT_STEALTH_IGNORE_DEFAULT_ARGS];
  const detectedVersion = resolveChromeVersion({
    ...(input.executablePath !== undefined ? { executablePath: input.executablePath } : {}),
    ...(input.channel !== undefined ? { channel: input.channel } : {}),
  });
  const userAgent = input.userAgent ?? defaultDesktopUserAgent(process.platform, detectedVersion);
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
