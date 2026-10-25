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

/** Command-name prefix of a shell's secret store: `<prefix>_read` / `_write` / `_clear`. */
export type NativeSecretCommandPrefix = 'mobile_credential' | 'desktop_secret';

/**
 * OS-credential-store storage over a shell's `<prefix>_*` commands, which keep
 * an opaque string per key. The mobile shell's `mobile_credential_*` (key
 * hashed natively) and the Desktop shell's `desktop_secret_*` share the
 * `{ endpoint, payload }` argument shape.
 */
export function createNativeSecretStorage(
  invoke: DeviceCredentialInvoke,
  prefix: NativeSecretCommandPrefix = 'mobile_credential',
): KeyValueStorage {
  return {
    read: async (key) => {
      const payload = await invoke(`${prefix}_read`, { endpoint: key });
      return typeof payload === 'string' && payload.length > 0 ? payload : undefined;
    },
    write: async (key, value) => {
      await invoke(`${prefix}_write`, { endpoint: key, payload: value });
    },
    remove: async (key) => {
      await invoke(`${prefix}_clear`, { endpoint: key });
    },
  };
}
