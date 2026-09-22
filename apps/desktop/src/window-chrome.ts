/**
 * Window chrome contract for Desktop, Windows/Linux packaged, and Web.
 *
 * Titlebands consume `--traffic-light-clearance` / `--titleband-leading`.
 * Only macOS Overlay reserves the system traffic-light hole; Windows packaged
 * shell embeds native caption controls into the trailing cluster; every other
 * surface starts at normal padding.
 */
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

/** Project chrome + runtime onto `<html>` before first paint when possible. */
export function applyWindowChromeToDocument(
  root: HTMLElement,
  chrome: WindowChrome = readWindowChromeFromEnvironment(),
): void {
  root.dataset.windowChrome = chrome;
  root.dataset.runtime = chrome === 'web' ? 'web' : 'tauri';
}
