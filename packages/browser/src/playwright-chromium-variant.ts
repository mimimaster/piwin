/**
 * Playwright Chromium install variants. Headless Host launches use
 * chromium-headless-shell (~190MB); headed launches need full Chromium
 * (~340MB). Never install both, ffmpeg, Firefox, or WebKit for the workbench.
 */
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const PLAYWRIGHT_CHROMIUM_VARIANTS = ['headless-shell', 'chromium'] as const;
export type PlaywrightChromiumVariant = (typeof PLAYWRIGHT_CHROMIUM_VARIANTS)[number];

export const DEFAULT_PLAYWRIGHT_CHROMIUM_VARIANT: PlaywrightChromiumVariant = 'headless-shell';

type PlaywrightBrowsersJson = {
  browsers: Array<{ name: string; revision: string }>;
};

type PlaywrightHostPlatform = 'mac-arm64' | 'mac-x64' | 'linux-x64' | 'linux-arm64' | 'win-x64';

/** Tokens match playwright-core 1.61 registry EXECUTABLE_PATHS. */
const HEADLESS_SHELL_EXECUTABLE_TOKENS: Record<PlaywrightHostPlatform, string[]> = {
  'mac-arm64': ['chrome-headless-shell-mac-arm64', 'chrome-headless-shell'],
  'mac-x64': ['chrome-headless-shell-mac-x64', 'chrome-headless-shell'],
  'linux-x64': ['chrome-headless-shell-linux64', 'chrome-headless-shell'],
  'linux-arm64': ['chrome-linux', 'headless_shell'],
  'win-x64': ['chrome-headless-shell-win64', 'chrome-headless-shell.exe'],
};

export function playwrightChromiumInstallCliArgs(
  variant: PlaywrightChromiumVariant = DEFAULT_PLAYWRIGHT_CHROMIUM_VARIANT,
): string[] {
  if (variant === 'chromium') {
    return ['install', 'chromium', '--no-shell'];
  }
  return ['install', 'chromium', '--only-shell'];
}

export function resolvePlaywrightHeadlessShellExecutablePath(
  browsersPath: string,
  options?: { platform?: NodeJS.Platform; arch?: string; browsersJson?: PlaywrightBrowsersJson },
): string {
  const revision = readHeadlessShellRevision(options?.browsersJson);
  const hostPlatform = resolvePlaywrightHostPlatform(options?.platform, options?.arch);
  const tokens = HEADLESS_SHELL_EXECUTABLE_TOKENS[hostPlatform];
  if (tokens === undefined) {
    throw new Error(`unsupported Playwright host platform: ${hostPlatform}`);
  }
  return join(browsersPath, `chromium_headless_shell-${revision}`, ...tokens);
}

function readHeadlessShellRevision(browsersJson?: PlaywrightBrowsersJson): string {
  const document = browsersJson ?? loadPlaywrightBrowsersJson();
  const entry = document.browsers.find((browser) => browser.name === 'chromium-headless-shell');
  if (entry === undefined || entry.revision.trim() === '') {
    throw new Error('playwright-core browsers.json is missing chromium-headless-shell');
  }
  return entry.revision;
}

function loadPlaywrightBrowsersJson(): PlaywrightBrowsersJson {
  const require = createRequire(import.meta.url);
  const packageJsonPath = require.resolve('playwright-core/package.json');
  const jsonPath = join(dirname(packageJsonPath), 'browsers.json');
  return JSON.parse(readFileSync(jsonPath, 'utf8')) as PlaywrightBrowsersJson;
}

function resolvePlaywrightHostPlatform(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): PlaywrightHostPlatform {
  if (platform === 'darwin') {
    return arch === 'arm64' ? 'mac-arm64' : 'mac-x64';
  }
  if (platform === 'linux') {
    return arch === 'arm64' ? 'linux-arm64' : 'linux-x64';
  }
  return 'win-x64';
}
