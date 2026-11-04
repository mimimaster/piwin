/**
 * Launch (or reuse) the real Chrome that hosts the model web pages.
 *
 * Why the user's installed Chrome and a private profile:
 * - A bundled Chromium or a headless shell is what bot checks look for; a real
 *   Chrome window with a human login is what survives them (spike evidence in
 *   `docs/research/web-model-provider-spike.md`).
 * - The profile lives under `~/.piwin/web-model/`, never the user's default
 *   Chrome profile: Chrome refuses `--remote-debugging-port` on the default
 *   profile (>=136) and we must not touch their cookies.
 *
 * Invariants:
 * - One Chrome per profile directory; a second call reuses the running one.
 * - Nothing here prints or logs login material.
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { CdpError, readBrowserVersion } from './cdp.ts';

export const DEFAULT_CDP_PORT = 9333;

export interface ChromeProfile {
  /** Absolute profile directory passed as `--user-data-dir`. */
  dir: string;
  port: number;
}

export function defaultProfile(): ChromeProfile {
  return {
    dir: join(homedir(), '.piwin', 'web-model', 'chrome-profile'),
    port: DEFAULT_CDP_PORT,
  };
}

const CHROME_CANDIDATES: Record<NodeJS.Platform, string[]> = {
  darwin: [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Google Chrome Beta.app/Contents/MacOS/Google Chrome Beta',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ],
  win32: [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Chromium\\Application\\chrome.exe',
  ],
  linux: [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/snap/bin/chromium',
  ],
} as Record<NodeJS.Platform, string[]>;

/**
 * Pick the Chrome executable for this platform.
 *
 * `exists` is injected so the platform matrix is unit-testable without those
 * files being present on the test machine.
 */
export function resolveChromeExecutable(
  platform: NodeJS.Platform,
  exists: (path: string) => boolean = existsSync,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const override = env.PIWIN_WEB_MODEL_CHROME_PATH?.trim();
  if (override) {
    if (!exists(override)) throw new CdpError(`PIWIN_WEB_MODEL_CHROME_PATH does not exist: ${override}`);
    return override;
  }
  const candidates = CHROME_CANDIDATES[platform] ?? [];
  for (const candidate of candidates) {
    if (exists(candidate)) return candidate;
  }
  throw new CdpError(
    `Google Chrome was not found on ${platform}. Install Chrome, or set PIWIN_WEB_MODEL_CHROME_PATH. ` +
      `Tried: ${candidates.join(', ') || '(no candidates for this platform)'}`,
  );
}

export interface LaunchResult extends ChromeProfile {
  executable: string;
  browser: string;
  reused: boolean;
}

export interface LaunchOptions extends Partial<ChromeProfile> {
  executable?: string;
  windowSize?: string;
}

function launchArgs(profile: ChromeProfile, windowSize: string): string[] {
  return [
    `--remote-debugging-port=${profile.port}`,
    `--user-data-dir=${profile.dir}`,
    '--no-first-run',
    '--no-default-browser-check',
    // Keep the automation tell out of the page. The window and profile are real;
    // this only stops the flag Chrome would otherwise expose to `navigator`.
    '--disable-blink-features=AutomationControlled',
    `--window-size=${windowSize}`,
    'about:blank',
  ];
}

export async function ensureChrome(options: LaunchOptions = {}): Promise<LaunchResult> {
  const base = defaultProfile();
  const profile: ChromeProfile = {
    dir: options.dir ?? base.dir,
    port: options.port ?? base.port,
  };
  const executable = options.executable ?? resolveChromeExecutable(process.platform);

  try {
    const version = await readBrowserVersion(profile.port);
    return { ...profile, executable, browser: version.Browser, reused: true };
  } catch {
    // nothing is listening yet — start one
  }

  await mkdir(profile.dir, { recursive: true });
  const child = spawn(executable, launchArgs(profile, options.windowSize ?? '1440,960'), {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();

  const deadline = Date.now() + 20_000;
  let lastError = 'no response';
  while (Date.now() < deadline) {
    try {
      const version = await readBrowserVersion(profile.port);
      return { ...profile, executable, browser: version.Browser, reused: false };
    } catch (error) {
      lastError = (error as Error).message;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw new CdpError(
    `Chrome started (pid ${child.pid}) but the inspector never answered on port ${profile.port}: ${lastError}`,
  );
}
