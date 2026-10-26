import { isDesktopTauriRuntime } from '../tool-cards/shell-runtime.js';
import type {
  DesktopScreenCaptureOs,
  ScreenCaptureAuthorization,
  ScreenCaptureCapabilities,
  ScreenCaptureOutcome,
} from './screen-capture-os.js';

const UNSUPPORTED_CAPABILITIES: ScreenCaptureCapabilities = {
  supported: false,
  systemRegionPicker: false,
};

async function invokeScreenCapture<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core');
  return args === undefined ? invoke<T>(command) : invoke<T>(command, args);
}

/** Tauri bridge; outside Tauri (web shell, tests) capture reports unsupported. */
export function createTauriScreenCaptureOs(): DesktopScreenCaptureOs {
  return {
    async capabilities() {
      if (!isDesktopTauriRuntime()) {
        return UNSUPPORTED_CAPABILITIES;
      }
      return invokeScreenCapture<ScreenCaptureCapabilities>('screen_capture_capabilities');
    },
    authorizationStatus: () =>
      invokeScreenCapture<ScreenCaptureAuthorization>('screen_capture_authorization_status'),
    requestAuthorization: () =>
      invokeScreenCapture<ScreenCaptureAuthorization>('screen_capture_request_authorization'),
    openSystemSettings: () => invokeScreenCapture<void>('screen_capture_open_system_settings'),
    restartApp: () => invokeScreenCapture<void>('screen_capture_restart_app'),
    take: () => invokeScreenCapture<ScreenCaptureOutcome>('screen_capture_take'),
    async read(id) {
      const buffer = await invokeScreenCapture<ArrayBuffer>('screen_capture_read', { id });
      return new Uint8Array(buffer);
    },
  };
}
