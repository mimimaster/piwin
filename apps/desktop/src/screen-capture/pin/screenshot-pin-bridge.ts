/**
 * The pin window's side of `src-tauri/src/screen_capture/pin.rs`.
 * A port so the pin app is testable without Tauri.
 */
export interface ScreenshotPinBridge {
  image(): Promise<Uint8Array>;
  close(): Promise<void>;
}

async function invokePin<T>(command: string): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(command);
}

export function createTauriPinBridge(): ScreenshotPinBridge {
  return {
    async image() {
      const buffer = await invokePin<ArrayBuffer>('screen_capture_pin_image');
      return new Uint8Array(buffer);
    },
    close: () => invokePin<void>('screen_capture_pin_close'),
  };
}
