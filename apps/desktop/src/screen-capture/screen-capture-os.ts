/**
 * Desktop screen capture port (spec 2026-10-25 SC-I02). Capture runs on the
 * user's machine, never the Host; `screen-capture-os-tauri.ts` implements it.
 */

/**
 * `overlay` (macOS, Windows): piwin's own full-screen overlay picks the region,
 * annotates and copies to the clipboard. `system-picker` (Linux): the desktop
 * portal picks the region and the editor opens inside the main window.
 */
export type ScreenCaptureMode = 'overlay' | 'system-picker';

export type ScreenCaptureCapabilities = {
  supported: boolean;
  mode: ScreenCaptureMode;
};

export type ScreenCaptureAuthorization = 'authorized' | 'not-determined-or-denied' | 'unsupported';

export type ScreenCaptureOutcome =
  | {
      status: 'captured';
      /** Set when the image should be read back (composer or editor). */
      id: string | null;
      width: number;
      height: number;
      byteLength: number;
      /** The overlay already annotated it; otherwise the editor still has to. */
      annotated: boolean;
      /** The finished image is on the system clipboard. */
      copied: boolean;
    }
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
  /** `deliverToComposer`: also hand the result back for the composer, not only the clipboard. */
  take(options: { deliverToComposer: boolean }): Promise<ScreenCaptureOutcome>;
  read(id: string): Promise<Uint8Array>;
}
