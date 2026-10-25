import type { DeviceCredentialInvoke } from '../device-credential-vault.js';

/**
 * String storage a shell injects: a file, localStorage or IndexedDB for the
 * host book; the system Keychain for secrets. This package never touches a
 * platform API itself.
 */
export type KeyValueStorage = {
  read(key: string): Promise<string | undefined>;
  write(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
};

export function createMemoryKeyValueStorage(): KeyValueStorage {
  const values = new Map<string, string>();
  return {
    read: async (key) => values.get(key),
    write: async (key, value) => {
      values.set(key, value);
    },
    remove: async (key) => {
      values.delete(key);
    },
  };
}

/**
 * Keychain-backed storage over the shell's `mobile_credential_*` commands,
 * which store an opaque string per key (the key is hashed natively). Reused so
 * ADR 0101 secrets need no new native surface.
 */
export function createNativeSecretStorage(invoke: DeviceCredentialInvoke): KeyValueStorage {
  return {
    read: async (key) => {
      const payload = await invoke('mobile_credential_read', { endpoint: key });
      return typeof payload === 'string' && payload.length > 0 ? payload : undefined;
    },
    write: async (key, value) => {
      await invoke('mobile_credential_write', { endpoint: key, payload: value });
    },
    remove: async (key) => {
      await invoke('mobile_credential_clear', { endpoint: key });
    },
  };
}
