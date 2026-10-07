/**
 * Which shell hosts this page.
 *
 * The same build runs in a browser tab, in the Desktop Tauri window, and as
 * the default interface of the iOS/Android Tauri shell (apps/mobile). The
 * mobile shell exposes the Tauri bridge but none of the Desktop native
 * commands (PTY, window chrome, sidecar, file dialogs), so "is there a Tauri
 * bridge" and "is this the Desktop app" are different questions.
 */

export type ShellRuntime = 'browser' | 'desktop-tauri' | 'mobile-tauri';

export type ShellRuntimeInput = {
  hasTauriBridge: boolean;
  userAgent: string;
  maxTouchPoints: number;
};

const MOBILE_USER_AGENT = /iPhone|iPad|iPod|Android/;

export function resolveShellRuntime(input: ShellRuntimeInput): ShellRuntime {
  if (!input.hasTauriBridge) {
    return 'browser';
  }
  if (MOBILE_USER_AGENT.test(input.userAgent)) {
    return 'mobile-tauri';
  }
  // iPadOS asks for the desktop site by default and then reports a Macintosh
  // user agent; a touch digitizer is what tells it apart from a real Mac.
  if (input.userAgent.includes('Macintosh') && input.maxTouchPoints > 1) {
    return 'mobile-tauri';
  }
  return 'desktop-tauri';
}

export function readShellRuntime(
  view: Window | undefined = typeof window === 'undefined' ? undefined : window,
): ShellRuntime {
  if (view === undefined) {
    return 'browser';
  }
  return resolveShellRuntime({
    hasTauriBridge: '__TAURI_INTERNALS__' in view,
    userAgent: view.navigator?.userAgent ?? '',
    maxTouchPoints: view.navigator?.maxTouchPoints ?? 0,
  });
}

/**
 * A touch-first device raises an on-screen keyboard on every programmatic
 * focus, covering half the screen. Convenience focus (session switch, cold
 * start) must be skipped there; focus that follows a user tap is still fine.
 */
export function usesOnScreenKeyboard(
  view: Window | undefined = typeof window === 'undefined' ? undefined : window,
): boolean {
  if (view === undefined || typeof view.matchMedia !== 'function') {
    return false;
  }
  return view.matchMedia('(pointer: coarse)').matches;
}

/** Any Tauri shell: the native plugin bridge (WebSocket, …) is reachable. */
export function hasTauriBridge(): boolean {
  return readShellRuntime() !== 'browser';
}

/** The Desktop app: Desktop-only native commands and window chrome exist. */
export function isDesktopTauriRuntime(): boolean {
  return readShellRuntime() === 'desktop-tauri';
}

/** The iOS/Android shell rendering this page as its default interface. */
export function isMobileTauriRuntime(): boolean {
  return readShellRuntime() === 'mobile-tauri';
}
