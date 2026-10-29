/**
 * The capture overlay window's side of `src-tauri/src/screen_capture/overlay.rs`.
 * A port so the overlay app is testable without Tauri.
 */
export interface ScreenCaptureOverlayBridge {
  /** The frozen screenshot of the monitor this window covers. */
  image(): Promise<Uint8Array>;
  /** The image loaded; native stops the load timeout. */
  ready(): Promise<void>;
  finish(png: Uint8Array): Promise<void>;
  cancel(): Promise<void>;
}

async function invokeOverlay<T>(command: string, args?: Uint8Array): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core');
  return args === undefined ? invoke<T>(command) : invoke<T>(command, args);
}

export function createTauriOverlayBridge(): ScreenCaptureOverlayBridge {
  return {
    async image() {
      const buffer = await invokeOverlay<ArrayBuffer>('screen_capture_overlay_image');
      return new Uint8Array(buffer);
    },
    ready: () => invokeOverlay<void>('screen_capture_overlay_ready'),
    // Raw body: the PNG is not wrapped in JSON on the way to native.
    finish: (png) => invokeOverlay<void>('screen_capture_overlay_finish', png),
    cancel: () => invokeOverlay<void>('screen_capture_overlay_cancel'),
  };
}
