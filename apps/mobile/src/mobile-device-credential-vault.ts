import { isTrustedDeviceCredential, type TrustedDeviceCredential } from '@piwin/contracts';

export type MobileDeviceCredentialVault = {
  read(endpoint: string): Promise<TrustedDeviceCredential | undefined>;
  write(endpoint: string, credential: TrustedDeviceCredential): Promise<void>;
  clear(endpoint: string): Promise<void>;
};

const MOBILE_CREDENTIAL_READ_TIMEOUT_MS = 1_500;

/**
 * A missing native credential must not prevent an anonymous loopback Host connection.
 * Keychain availability is optional for the first connection, especially in Simulator.
 */
export function readMobileDeviceCredential(
  vault: MobileDeviceCredentialVault,
  endpoint: string,
): Promise<TrustedDeviceCredential | undefined> {
  return new Promise<TrustedDeviceCredential | undefined>((resolve) => {
    let settled = false;
    const finish = (credential: TrustedDeviceCredential | undefined): void => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(credential);
    };
    const timeout = setTimeout(() => {
      if (settled) {
        return;
      }
      console.warn('[piwin-mobile] device credential read timed out; continuing without it');
      finish(undefined);
    }, MOBILE_CREDENTIAL_READ_TIMEOUT_MS);

    try {
      void vault.read(endpoint).then(
        (credential) => {
          clearTimeout(timeout);
          finish(credential);
        },
        () => {
          clearTimeout(timeout);
          console.warn('[piwin-mobile] device credential read failed; continuing without it');
          finish(undefined);
        },
      );
    } catch {
      clearTimeout(timeout);
      console.warn('[piwin-mobile] device credential read failed; continuing without it');
      finish(undefined);
    }
  });
}

type InvokeFn = (command: string, args: Record<string, unknown>) => Promise<unknown>;

/**
 * Device secrets stay in process memory. Never write them to localStorage —
 * WKWebView storage is not a Keychain.
 */
export function createMemoryMobileDeviceCredentialVault(): MobileDeviceCredentialVault {
  const secrets = new Map<string, TrustedDeviceCredential>();
  return {
    async read(endpoint) {
      return secrets.get(normalizeEndpoint(endpoint));
    },
    async write(endpoint, credential) {
      if (!isTrustedDeviceCredential(credential)) {
        throw new Error('Device credential is invalid');
      }
      secrets.set(normalizeEndpoint(endpoint), credential);
    },
    async clear(endpoint) {
      secrets.delete(normalizeEndpoint(endpoint));
    },
  };
}

export function createTauriMobileDeviceCredentialVault(invoke: InvokeFn): MobileDeviceCredentialVault {
  return {
    async read(endpoint) {
      const payload = await invoke('mobile_credential_read', { endpoint: normalizeEndpoint(endpoint) });
      return parseStoredCredential(payload);
    },
    async write(endpoint, credential) {
      if (!isTrustedDeviceCredential(credential)) {
        throw new Error('Device credential is invalid');
      }
      await invoke('mobile_credential_write', {
        endpoint: normalizeEndpoint(endpoint),
        payload: JSON.stringify(credential),
      });
    },
    async clear(endpoint) {
      await invoke('mobile_credential_clear', { endpoint: normalizeEndpoint(endpoint) });
    },
  };
}

export function createMobileDeviceCredentialVault(invoke?: InvokeFn): MobileDeviceCredentialVault {
  if (invoke !== undefined && isNativeTauriRuntime()) {
    return createTauriMobileDeviceCredentialVault(invoke);
  }
  return createMemoryMobileDeviceCredentialVault();
}

export function isNativeTauriRuntime(): boolean {
  return typeof globalThis !== 'undefined' && '__TAURI_INTERNALS__' in globalThis;
}

function parseStoredCredential(value: unknown): TrustedDeviceCredential | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string' || value.trim().length === 0) {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(value);
    return isTrustedDeviceCredential(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function normalizeEndpoint(endpoint: string): string {
  return endpoint.trim();
}
