/**
 * Device enrolment for the mobile shell (ADR 0075/0076).
 *
 * A phone reaches the Host over the LAN, where a hello is admitted only with a
 * one-time pairing token or the device credential that token was traded for.
 * The credential lives in the system Keychain; reading it is asynchronous,
 * while the workbench builds its Host client synchronously. This module keeps
 * the credential for the current process once it has been read, so the client
 * factory can pick it up without awaiting.
 *
 * Outside the mobile shell the vault is in-memory: a browser tab or the
 * Desktop app has no enrolment and never stores a device secret.
 */
import type { TrustedDeviceCredential } from '@piwin/contracts';
import {
  createMemoryDeviceCredentialVault,
  createNativeDeviceCredentialVault,
  readDeviceCredential,
  type DeviceCredentialVault,
} from '@piwin/host-client';
import { isMobileTauriRuntime, readShellRuntime } from './shell-runtime.js';

const primedCredentials = new Map<string, TrustedDeviceCredential>();
let sharedVault: DeviceCredentialVault | undefined;

function deviceCredentialVault(): DeviceCredentialVault {
  if (sharedVault === undefined) {
    sharedVault = isMobileTauriRuntime()
      ? createNativeDeviceCredentialVault(async (command, args) => {
          const { invoke } = await import('@tauri-apps/api/core');
          return invoke(command, args);
        })
      : createMemoryDeviceCredentialVault();
  }
  return sharedVault;
}

/** Test seam: swap the vault and drop anything read from the previous one. */
export function setDeviceCredentialVaultForTesting(vault: DeviceCredentialVault | undefined): void {
  sharedVault = vault;
  primedCredentials.clear();
}

/** Load the stored credential for `endpoint` so the next client can present it. */
export async function primeDeviceCredential(endpoint: string): Promise<void> {
  const key = endpoint.trim();
  if (key.length === 0) {
    return;
  }
  const credential = await readDeviceCredential(deviceCredentialVault(), key);
  if (credential === undefined) {
    primedCredentials.delete(key);
    return;
  }
  primedCredentials.set(key, credential);
}

export function peekDeviceCredential(endpoint: string): TrustedDeviceCredential | undefined {
  return primedCredentials.get(endpoint.trim());
}

/** Called when the Host issues a credential in exchange for a pairing token. */
export async function rememberDeviceCredential(
  endpoint: string,
  credential: TrustedDeviceCredential,
): Promise<void> {
  const key = endpoint.trim();
  // Process memory first: the live session keeps working even if the Keychain
  // write fails, and the failure still reaches the caller.
  primedCredentials.set(key, credential);
  await deviceCredentialVault().write(key, credential);
}

/**
 * Present the credential issued for `fromEndpoint` when dialling `toEndpoint`,
 * another address of the same Host. In memory only until the Host accepts it
 * there; call `rememberDeviceCredential` then, or `releasePrimedDeviceCredential`
 * if it did not.
 */
export function lendDeviceCredential(fromEndpoint: string, toEndpoint: string): boolean {
  const credential = primedCredentials.get(fromEndpoint.trim());
  if (credential === undefined) {
    return false;
  }
  primedCredentials.set(toEndpoint.trim(), credential);
  return true;
}

/** Drop an in-memory credential without touching the vault. */
export function releasePrimedDeviceCredential(endpoint: string): void {
  primedCredentials.delete(endpoint.trim());
}

export async function forgetDeviceCredential(endpoint: string): Promise<void> {
  const key = endpoint.trim();
  primedCredentials.delete(key);
  await deviceCredentialVault().clear(key);
}

export type AdmissionKey =
  | { kind: 'pairing-token'; pairingToken: string }
  | { kind: 'device-credential'; deviceCredential: TrustedDeviceCredential }
  | { kind: 'auth-token'; authToken: string };

/**
 * A hello carries exactly one admission key, but a shell can hold several at
 * once: a re-scan on an already paired phone has a fresh pairing token next to
 * the stored credential, and a saved door token can sit beside either. The
 * freshest proof wins: a just-scanned pairing token (the stored credential may
 * have been revoked), then the device credential, then the door token.
 */
export function selectAdmissionKey(input: {
  pairingToken?: string | undefined;
  deviceCredential?: TrustedDeviceCredential | undefined;
  authToken?: string | undefined;
}): AdmissionKey | undefined {
  const pairingToken = input.pairingToken?.trim() ?? '';
  if (pairingToken.length > 0) {
    return { kind: 'pairing-token', pairingToken };
  }
  if (input.deviceCredential !== undefined) {
    return { kind: 'device-credential', deviceCredential: input.deviceCredential };
  }
  const authToken = input.authToken?.trim() ?? '';
  return authToken.length > 0 ? { kind: 'auth-token', authToken } : undefined;
}

/** Name shown in the Host's paired-device list. */
export function describeThisDevice(
  userAgent: string = typeof navigator === 'undefined' ? '' : navigator.userAgent,
): string {
  if (readShellRuntime() !== 'mobile-tauri') {
    return 'Piwin shell';
  }
  if (userAgent.includes('iPhone')) {
    return 'Piwin iPhone';
  }
  if (userAgent.includes('Android')) {
    return 'Piwin Android';
  }
  return 'Piwin iPad';
}
