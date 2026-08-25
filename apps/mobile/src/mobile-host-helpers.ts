import type { HostClient } from '@piwin/host-client';
import type { MobileClientToolRuntime } from './client-tools/mobile-client-tool-runtime.js';
import {
  createMemoryMobileDeviceCredentialVault,
  createTauriMobileDeviceCredentialVault,
  isNativeTauriRuntime,
  type MobileDeviceCredentialVault,
} from './mobile-device-credential-vault.js';

export function createMobileVault(): MobileDeviceCredentialVault {
  if (!isNativeTauriRuntime()) {
    return createMemoryMobileDeviceCredentialVault();
  }
  return createTauriMobileDeviceCredentialVault(async (command, args) => {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke(command, args);
  });
}

export function disposeClient(
  clientRef: { current: HostClient | undefined },
  unsubscribeRef: { current: Array<() => void> },
  activityRefreshTimerRef?: { current: ReturnType<typeof setTimeout> | undefined },
  healthRuntimeRef?: { current: MobileClientToolRuntime | undefined },
): void {
  if (activityRefreshTimerRef?.current !== undefined) {
    clearTimeout(activityRefreshTimerRef.current);
    activityRefreshTimerRef.current = undefined;
  }
  healthRuntimeRef?.current?.stop();
  if (healthRuntimeRef !== undefined) {
    healthRuntimeRef.current = undefined;
  }
  for (const unsubscribe of unsubscribeRef.current) {
    unsubscribe();
  }
  unsubscribeRef.current = [];
  const client = clientRef.current;
  clientRef.current = undefined;
  if (client !== undefined) {
    void client.close();
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function toError(error: unknown, fallback: string = '未知错误'): Error {
  return error instanceof Error ? error : new Error(fallback);
}

export function readFileAsBase64(file: File): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        reject(new Error('Unable to read selected image'));
        return;
      }
      const separatorIndex = reader.result.indexOf(',');
      if (separatorIndex < 0) {
        reject(new Error('Selected image has an invalid data URL'));
        return;
      }
      resolve(reader.result.slice(separatorIndex + 1));
    };
    reader.onerror = () => reject(reader.error ?? new Error('Unable to read selected image'));
    reader.readAsDataURL(file);
  });
}
