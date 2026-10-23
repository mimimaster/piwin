/**
 * Windows defaults for the secret resolver: Credential Manager first, the
 * file store as fallback, and lazy migration of plaintext file secrets.
 */
import { formatError } from '@piwin/contracts';
import {
  deleteFileSecret,
  readFileSecret,
  secretServiceName,
  writeFileSecret,
} from './secret-file-store.js';
import type { WindowsCredentialStore } from './windows-credential-store.js';

/**
 * Windows defaults. Every Credential Manager call starts PowerShell and
 * compiles the P/Invoke shim (around a second), so values are cached for the
 * Host's lifetime; this process is the only writer through the resolver, and
 * write/delete keep the cache current.
 */
export function createWindowsSecretDefaults(
  root: string,
  store: WindowsCredentialStore,
): {
  read: (ref: string) => Promise<string | null>;
  write: (ref: string, secret: string) => Promise<void>;
  delete: (ref: string) => Promise<void>;
} {
  const cache = new Map<string, string | null>();

  async function read(ref: string): Promise<string | null> {
    const service = secretServiceName(ref);
    if (cache.has(service)) return cache.get(service) ?? null;
    let value: string | null;
    try {
      value = await store.read(service);
    } catch (error) {
      // Credential Manager unavailable (policy, broken PowerShell): the file
      // store still answers, and nothing is cached so a later read retries.
      console.warn(`[piwin/secrets] ${formatError(error)}; using the file store`);
      return readFileSecret(root, service);
    }
    if (value === null) {
      value = await migrateFileSecret(root, service, store);
    }
    cache.set(service, value);
    return value;
  }

  async function write(ref: string, secret: string): Promise<void> {
    const service = secretServiceName(ref);
    try {
      await store.write(service, secret);
      await deleteFileSecret(root, service);
    } catch (error) {
      // Same rule as a locked macOS keychain: a key update must not be lost.
      console.warn(`[piwin/secrets] ${formatError(error)}; keeping the key in the file store`);
      await writeFileSecret(root, service, secret);
    }
    cache.set(service, secret);
  }

  async function remove(ref: string): Promise<void> {
    const service = secretServiceName(ref);
    cache.delete(service);
    await store.delete(service);
    await deleteFileSecret(root, service);
  }

  return { read, write, delete: remove };
}

/** Move a plaintext file-store secret into Credential Manager; the file goes only after the write. */
async function migrateFileSecret(
  root: string,
  service: string,
  store: WindowsCredentialStore,
): Promise<string | null> {
  const fromFile = await readFileSecret(root, service);
  if (fromFile === null) return null;
  try {
    await store.write(service, fromFile);
    await deleteFileSecret(root, service);
  } catch (error) {
    console.warn(
      `[piwin/secrets] could not move ${service} into Windows Credential Manager: ${formatError(error)}`,
    );
  }
  return fromFile;
}
