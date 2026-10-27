/**
 * Desktop screen capture port (spec 2026-10-25 SC-I02). Capture runs on the
 * user's machine, never the Host; `screen-capture-os-tauri.ts` implements it.
 */

export type ScreenCaptureCapabilities = {
  supported: boolean;
  /** true: the OS draws the region picker (macOS). false: crop happens in the editor. */
  systemRegionPicker: boolean;
};

export type ScreenCaptureAuthorization = 'authorized' | 'not-determined-or-denied' | 'unsupported';

export type ScreenCaptureOutcome =
  | { status: 'captured'; id: string; width: number; height: number; byteLength: number }
  | { status: 'cancelled' }
  | { status: 'failed'; code: string };

/** Stable `failed.code` values from the native side. */
export const SCREEN_CAPTURE_ERROR = {
  busy: 'SCREEN_CAPTURE_BUSY',
  denied: 'SCREEN_CAPTURE_DENIED',
  unsupported: 'SCREEN_CAPTURE_UNSUPPORTED',
  failed: 'SCREEN_CAPTURE_FAILED',
  notFound: 'SCREEN_CAPTURE_NOT_FOUND',
} as const;

export interface DesktopScreenCaptureOs {
  capabilities(): Promise<ScreenCaptureCapabilities>;
  authorizationStatus(): Promise<ScreenCaptureAuthorization>;
  requestAuthorization(): Promise<ScreenCaptureAuthorization>;
  openSystemSettings(): Promise<void>;
  /** Relaunch so a new macOS Screen Recording grant takes effect. */
  restartApp(): Promise<void>;
  /** Bring the main window forward; a global-shortcut trigger may come from another app. */
  revealApp(): Promise<void>;
  /** System-wide shortcut presses (⇧⌘A / Ctrl+Shift+A). Resolves to an unsubscribe. */
  onShortcut(listener: () => void): Promise<() => void>;
  take(): Promise<ScreenCaptureOutcome>;
  read(id: string): Promise<Uint8Array>;
}
