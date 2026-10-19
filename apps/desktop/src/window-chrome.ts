/**
 * Window chrome contract for Desktop, Windows/Linux packaged, and Web.
 *
 * Titlebands consume `--traffic-light-clearance` / `--titleband-leading`.
 * Only macOS Overlay reserves the system traffic-light hole; Windows packaged
 * shell embeds native caption controls into the trailing cluster; every other
 * surface starts at normal padding.
 */
import { readShellRuntime } from './shell-runtime.js';
import { isTauriRuntime } from './tauri-pty.js';

export const WINDOW_CHROME_VALUES = [
  'macos-overlay',
  'windows-caption',
  'native-frame',
  'web',
] as const;

export type WindowChrome = (typeof WINDOW_CHROME_VALUES)[number];

/** Matches `trafficLightPosition` + light cluster width in tauri.conf.json. */
export const MACOS_OVERLAY_CLEARANCE_PX = 78;

export function isMacDesktopPlatform(platform: string, userAgent: string): boolean {
  return platform.includes('Mac') || userAgent.includes('Mac');
}

export function isWindowsDesktopPlatform(platform: string, userAgent: string): boolean {
  return platform.includes('Win') || userAgent.includes('Win');
}

export function resolveWindowChrome(input: {
  isTauri: boolean;
  platform: string;
  userAgent: string;
}): WindowChrome {
  if (!input.isTauri) return 'web';
  if (isMacDesktopPlatform(input.platform, input.userAgent)) return 'macos-overlay';
  if (isWindowsDesktopPlatform(input.platform, input.userAgent)) return 'windows-caption';
  return 'native-frame';
}

export function readWindowChromeFromEnvironment(
  view: Window | undefined = typeof window === 'undefined' ? undefined : window,
): WindowChrome {
  if (view === undefined) return 'web';
  const fromDoc = view.document?.documentElement?.dataset?.windowChrome as
    | WindowChrome
    | undefined;
  if (fromDoc && (WINDOW_CHROME_VALUES as readonly string[]).includes(fromDoc)) {
    return fromDoc;
  }
  return resolveWindowChrome({
    isTauri: isTauriRuntime(),
    platform: view.navigator.platform ?? '',
    userAgent: view.navigator.userAgent ?? '',
  });
}

/**
 * The system material composited behind the transparent main window
 * (tauri.conf.json `windowEffects`): an NSVisualEffectView on macOS, Mica on
 * Windows 11. Absent everywhere else, where the shell must stay opaque.
 */
export type NativeWindowMaterial = 'vibrancy' | 'mica';

export function readNativeWindowMaterial(
  root: HTMLElement | undefined = typeof document === 'undefined' ? undefined : document.documentElement,
): NativeWindowMaterial | undefined {
  const value = root?.dataset.nativeWindowMaterial;
  return value === 'vibrancy' || value === 'mica' ? value : undefined;
}

/** Minimal User-Agent Client Hints surface; not in TypeScript's DOM lib. */
interface NavigatorWithClientHints {
  userAgentData?: {
    getHighEntropyValues(hints: readonly string[]): Promise<{ platformVersion?: string }>;
  };
}

/**
 * Mica only exists on Windows 11; on 10 the transparent window has nothing
 * behind it. Chromium (WebView2) reports Windows 11 as platformVersion >= 13.
 */
export async function isWindowsMicaSupported(navigatorLike: NavigatorWithClientHints): Promise<boolean> {
  const clientHints = navigatorLike.userAgentData;
  if (clientHints === undefined) return false;
  const { platformVersion } = await clientHints.getHighEntropyValues(['platformVersion']);
  const major = Number.parseInt(platformVersion?.split('.')[0] ?? '', 10);
  return Number.isFinite(major) && major >= 13;
}

/**
 * Marks `<html data-native-window-material>`. Windows needs an async OS
 * probe, so callers that read the material at render time await this first.
 */
export async function applyNativeWindowMaterialToDocument(
  root: HTMLElement,
  chrome: WindowChrome = readWindowChromeFromEnvironment(),
  navigatorLike: NavigatorWithClientHints = typeof navigator === 'undefined'
    ? {}
    : (navigator as Navigator & NavigatorWithClientHints),
): Promise<void> {
  delete root.dataset.nativeWindowMaterial;
  if (chrome === 'macos-overlay') {
    root.dataset.nativeWindowMaterial = 'vibrancy';
    return;
  }
  if (chrome !== 'windows-caption') return;
  try {
    if (await isWindowsMicaSupported(navigatorLike)) {
      root.dataset.nativeWindowMaterial = 'mica';
    }
  } catch (error: unknown) {
    console.warn('[window-chrome] Windows version probe failed; keeping the window opaque:', error);
  }
}

/** Project chrome + runtime onto `<html>` before first paint when possible. */
export function applyWindowChromeToDocument(
  root: HTMLElement,
  chrome: WindowChrome = readWindowChromeFromEnvironment(),
): void {
  root.dataset.windowChrome = chrome;
  root.dataset.runtime = chrome === 'web' ? 'web' : 'tauri';
  // The mobile shell paints as `web` chrome; CSS that must tell an installed
  // phone app from a browser tab (no ⌘ hints, no browser UI) reads this.
  root.dataset.shellRuntime = readShellRuntime();
}
