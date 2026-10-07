import {
  createMemoryDeviceCredentialVault,
  createNativeDeviceCredentialVault,
  readDeviceCredential,
  type DeviceCredentialInvoke,
  type DeviceCredentialVault,
} from '@piwin/host-client';

/**
 * The vault itself lives in @piwin/host-client so both shell interfaces share
 * one Keychain format. These names stay for the classic interface.
 */
export type MobileDeviceCredentialVault = DeviceCredentialVault;

export const readMobileDeviceCredential = readDeviceCredential;
export const createMemoryMobileDeviceCredentialVault = createMemoryDeviceCredentialVault;
export const createTauriMobileDeviceCredentialVault = createNativeDeviceCredentialVault;

export function createMobileDeviceCredentialVault(
  invoke?: DeviceCredentialInvoke,
): MobileDeviceCredentialVault {
  if (invoke !== undefined && isNativeTauriRuntime()) {
    return createNativeDeviceCredentialVault(invoke);
  }
  return createMemoryDeviceCredentialVault();
}

export function isNativeTauriRuntime(): boolean {
  return typeof globalThis !== 'undefined' && '__TAURI_INTERNALS__' in globalThis;
}
