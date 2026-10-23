/**
 * Resolve provider secrets without logging values.
 * Precedence: apiKeyRef (oauth: from auth.json, else keychain, then Host file store) → apiKeyEnv → error.
 *
 * `oauth:<providerId>` is not a keychain entry. The token lives in
 * `{piwinRoot}/pi-agent/auth.json` and is owned by login/logout.
 *
 * Platform stores: macOS keychain, Windows Credential Manager. Hosts without
 * one (Linux NAS / server) persist shell-updated keys under `~/.piwin/secrets/`
 * (0600) so `secrets/set` works there. On Windows that file store is plaintext
 * (chmod is a no-op), so a file found there is moved into Credential Manager
 * the first time it is read.
 */
import { join } from 'node:path';
import type { ModelProviderConfig } from '@piwin/contracts';
import {
  formatError,
  isOauthSecretRef,
  oauthSecretRefProviderId,
  toDevinSessionToken,
} from '@piwin/contracts';
import { readOauthAccessToken } from '@piwin/agent-host';
import { getPiwinPiAgentDir, getPiwinRoot } from './paths.js';
import { deleteMacKeychain, readMacKeychain, writeMacKeychain } from './macos-keychain-store.js';
import {
  deleteFileSecret,
  readFileSecret,
  secretServiceName,
  writeFileSecret,
} from './secret-file-store.js';
import {
  createWindowsCredentialStore,
  type WindowsCredentialStore,
} from './windows-credential-store.js';
import { createWindowsSecretDefaults } from './windows-secret-defaults.js';

export type SecretResolveStatus = 'ok' | 'missing' | 'error';

export type SecretResolveReport = {
  providerId: string;
  status: SecretResolveStatus;
  source?: 'env' | 'keychain';
  /** Safe diagnostic only — never the secret. */
  detail?: string;
};

export type SecretResolver = {
  resolveProviderSecret: (provider: ModelProviderConfig) => Promise<string>;
  reportProviderSecret: (provider: ModelProviderConfig) => Promise<SecretResolveReport>;
  /** Persist secret to keychain; returns apiKeyRef (e.g. keychain:piwin-openai). */
  writeProviderSecret: (providerId: string, secret: string) => Promise<string>;
  /** Read raw secret for key management (never log). Multi-line = multiple keys. */
  readProviderSecret: (providerId: string) => Promise<string | null>;
  /** Write a secret to an explicit keychain ref (e.g. keychain:piwin-plugin-...). */
  writeSecretByRef: (ref: string, secret: string) => Promise<void>;
  /** Read a secret from an explicit keychain ref. Returns null if not found. */
  readSecretByRef: (ref: string) => Promise<string | null>;
  /** Remove a provider secret. Empty string is not a delete. */
  deleteProviderSecret: (providerId: string) => Promise<void>;
  deleteSecretByRef: (ref: string) => Promise<void>;
};

export type CreateSecretResolverOptions = {
  env?: NodeJS.ProcessEnv;
  /** Injected keychain lookup for tests / non-macOS. */
  readKeychain?: (ref: string) => Promise<string | null>;
  /** Injected keychain write for tests / non-macOS. */
  writeKeychain?: (ref: string, secret: string) => Promise<void>;
  /** Host config root. File-backed secrets live at `<root>/secrets/`. */
  piwinRoot?: string;
  /** Tests: skip macOS keychain and use the file store only. */
  preferFileStore?: boolean;
  deleteKeychain?: (ref: string) => Promise<void>;
  /** Tests: platform whose native store the default read/write/delete use. */
  platform?: NodeJS.Platform;
  /** Tests: Windows Credential Manager stand-in. */
  windowsStore?: WindowsCredentialStore;
};

export function createSecretResolver(options: CreateSecretResolverOptions = {}): SecretResolver {
  const env = options.env ?? process.env;
  const root = options.piwinRoot ?? getPiwinRoot();
  const preferFileStore = options.preferFileStore === true;
  const platform = options.platform ?? process.platform;
  const defaults =
    platform === 'win32' && !preferFileStore
      ? createWindowsSecretDefaults(root, options.windowsStore ?? createWindowsCredentialStore())
      : {
          read: (ref: string) => defaultReadSecret(ref, root, preferFileStore, platform),
          write: (ref: string, secret: string) =>
            defaultWriteSecret(ref, secret, root, preferFileStore, platform),
          delete: (ref: string) => defaultDeleteSecret(ref, root, preferFileStore, platform),
        };
  const readKeychain = options.readKeychain ?? defaults.read;
  const writeKeychain = options.writeKeychain ?? defaults.write;
  const deleteKeychain = options.deleteKeychain ?? defaults.delete;

  async function resolveProviderSecret(provider: ModelProviderConfig): Promise<string> {
    if (provider.apiKeyRef?.trim()) {
      const fromRef = await readSecretByRef(provider.apiKeyRef);
      if (fromRef && fromRef.length > 0) {
        // First non-empty line is the active key (multi-key store).
        const firstLine = fromRef
          .split(/\r?\n/)
          .map((line) => line.trim())
          .find((line) => line.length > 0);
        if (firstLine) {
          return firstLine;
        }
        return fromRef;
      }
    }
    if (provider.apiKeyEnv?.trim()) {
      const fromEnv = env[provider.apiKeyEnv.trim()];
      if (typeof fromEnv === 'string' && fromEnv.length > 0) {
        return fromEnv;
      }
    }
    throw new Error(
      provider.apiKeyEnv?.trim() || provider.apiKeyRef?.trim()
        ? `Provider ${provider.id}: API key is configured but could not be resolved (env unset or keychain empty).`
        : `Provider ${provider.id}: no API key. Paste a key in the provider form, or leave empty for local no-auth endpoints.`,
    );
  }

  async function writeProviderSecret(providerId: string, secret: string): Promise<string> {
    const trimmedId = providerId.trim();
    const trimmedSecret = secret.trim();
    if (!trimmedId) {
      throw new Error('providerId is required to store a secret');
    }
    if (!trimmedSecret) {
      throw new Error('secret is required');
    }
    const apiKeyRef = `keychain:piwin-${trimmedId}`;
    await writeKeychain(apiKeyRef, trimmedSecret);
    return apiKeyRef;
  }

  async function readProviderSecret(providerId: string): Promise<string | null> {
    const trimmedId = providerId.trim();
    if (!trimmedId) {
      return null;
    }
    const apiKeyRef = `keychain:piwin-${trimmedId}`;
    return readKeychain(apiKeyRef);
  }

  async function reportProviderSecret(provider: ModelProviderConfig): Promise<SecretResolveReport> {
    try {
      if (provider.apiKeyRef?.trim()) {
        const fromRef = await readSecretByRef(provider.apiKeyRef);
        if (fromRef && fromRef.length > 0) {
          return { providerId: provider.id, status: 'ok', source: 'keychain' };
        }
      }
      if (provider.apiKeyEnv?.trim()) {
        const fromEnv = env[provider.apiKeyEnv.trim()];
        if (typeof fromEnv === 'string' && fromEnv.length > 0) {
          return { providerId: provider.id, status: 'ok', source: 'env' };
        }
        return {
          providerId: provider.id,
          status: 'missing',
          detail: `env ${provider.apiKeyEnv} unset`,
        };
      }
      return {
        providerId: provider.id,
        status: 'missing',
        detail: 'no apiKeyEnv or apiKeyRef',
      };
    } catch (error) {
      return {
        providerId: provider.id,
        status: 'error',
        detail: formatError(error),
      };
    }
  }

  function rejectOauthSecretRef(ref: string): void {
    if (isOauthSecretRef(ref) || ref.startsWith('oauth:')) {
      throw new Error(
        `oauth secret refs are owned by auth.json login/logout and cannot be written or deleted via the secret store (${ref})`,
      );
    }
  }

  async function writeSecretByRef(ref: string, secret: string): Promise<void> {
    const trimmedRef = ref.trim();
    const trimmedSecret = secret.trim();
    if (!trimmedRef) {
      throw new Error('keychain ref is required to store a secret');
    }
    rejectOauthSecretRef(trimmedRef);
    if (!trimmedSecret) {
      throw new Error('secret is required');
    }
    await writeKeychain(trimmedRef, trimmedSecret);
  }

  async function readOauthSecretRef(trimmedRef: string): Promise<string | null> {
    const providerId = oauthSecretRefProviderId(trimmedRef)?.trim() ?? '';
    if (!providerId) {
      return null;
    }
    const authPath = join(getPiwinPiAgentDir(root), 'auth.json');
    const token = await readOauthAccessToken(authPath, providerId);
    if (!token) return null;
    // The Devin sign-in stores the bare JWT; its consumers here (code_search,
    // the Devin web-search source) speak the Windsurf API, which wants the
    // `devin-session-token$` form.
    return providerId === 'devin' ? toDevinSessionToken(token) : token;
  }

  async function readSecretByRef(ref: string): Promise<string | null> {
    const trimmedRef = ref.trim();
    if (!trimmedRef) {
      return null;
    }
    // OAuth tokens stay in auth.json. Never copy them into the keychain.
    if (trimmedRef.startsWith('oauth:')) {
      return readOauthSecretRef(trimmedRef);
    }
    return readKeychain(trimmedRef);
  }

  async function deleteSecretByRef(ref: string): Promise<void> {
    const trimmedRef = ref.trim();
    if (!trimmedRef) {
      throw new Error('keychain ref is required to delete a secret');
    }
    rejectOauthSecretRef(trimmedRef);
    await deleteKeychain(trimmedRef);
  }

  async function deleteProviderSecret(providerId: string): Promise<void> {
    const trimmedId = providerId.trim();
    if (!trimmedId) {
      throw new Error('providerId is required to delete a secret');
    }
    await deleteKeychain(`keychain:piwin-${trimmedId}`);
  }

  return {
    resolveProviderSecret,
    reportProviderSecret,
    writeProviderSecret,
    readProviderSecret,
    writeSecretByRef,
    readSecretByRef,
    deleteProviderSecret,
    deleteSecretByRef,
  };
}

async function defaultReadSecret(
  ref: string,
  root: string,
  preferFileStore: boolean,
  platform: NodeJS.Platform,
): Promise<string | null> {
  const service = secretServiceName(ref);
  if (platform === 'darwin' && !preferFileStore) {
    const fromKeychain = await readMacKeychain(service);
    if (fromKeychain) {
      return fromKeychain;
    }
  }
  return readFileSecret(root, service);
}

async function defaultWriteSecret(
  ref: string,
  secret: string,
  root: string,
  preferFileStore: boolean,
  platform: NodeJS.Platform,
): Promise<void> {
  const service = secretServiceName(ref);
  if (platform === 'darwin' && !preferFileStore) {
    try {
      await writeMacKeychain(service, secret);
      return;
    } catch {
      // Locked or headless keychain must not block a remote shell updating Host keys.
    }
  }
  await writeFileSecret(root, service, secret);
}

async function defaultDeleteSecret(
  ref: string,
  root: string,
  preferFileStore: boolean,
  platform: NodeJS.Platform,
): Promise<void> {
  const service = secretServiceName(ref);
  if (platform === 'darwin' && !preferFileStore) {
    await deleteMacKeychain(service).catch(() => undefined);
  }
  await deleteFileSecret(root, service);
}

/** @deprecated Use createSecretResolver write path; kept for existing imports. */
export async function defaultWriteKeychain(ref: string, secret: string): Promise<void> {
  await createSecretResolver().writeSecretByRef(ref, secret);
}
