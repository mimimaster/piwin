/**
 * Resolve provider secrets without logging values.
 * Precedence: apiKeyRef (keychain, then Host file store) → apiKeyEnv → error.
 *
 * Remote Hosts (Linux NAS / server) have no macOS keychain. Shell-updated keys
 * persist under `~/.piwin/secrets/` on the Host so `secrets/set` works there.
 */
import { spawn } from 'node:child_process';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ModelProviderConfig } from '@piwin/contracts';
import { formatError } from '@piwin/contracts';
import { getPiwinRoot } from './paths.js';

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
};

export function createSecretResolver(options: CreateSecretResolverOptions = {}): SecretResolver {
  const env = options.env ?? process.env;
  const root = options.piwinRoot ?? getPiwinRoot();
  const preferFileStore = options.preferFileStore === true;
  const readKeychain =
    options.readKeychain ?? ((ref) => defaultReadSecret(ref, root, preferFileStore));
  const writeKeychain =
    options.writeKeychain ?? ((ref, secret) => defaultWriteSecret(ref, secret, root, preferFileStore));

  async function resolveProviderSecret(provider: ModelProviderConfig): Promise<string> {
    if (provider.apiKeyRef?.trim()) {
      const fromRef = await readKeychain(provider.apiKeyRef.trim());
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
        const fromRef = await readKeychain(provider.apiKeyRef.trim());
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

  async function writeSecretByRef(ref: string, secret: string): Promise<void> {
    const trimmedRef = ref.trim();
    const trimmedSecret = secret.trim();
    if (!trimmedRef) {
      throw new Error('keychain ref is required to store a secret');
    }
    if (!trimmedSecret) {
      throw new Error('secret is required');
    }
    await writeKeychain(trimmedRef, trimmedSecret);
  }

  async function readSecretByRef(ref: string): Promise<string | null> {
    const trimmedRef = ref.trim();
    if (!trimmedRef) {
      return null;
    }
    return readKeychain(trimmedRef);
  }

  return {
    resolveProviderSecret,
    reportProviderSecret,
    writeProviderSecret,
    readProviderSecret,
    writeSecretByRef,
    readSecretByRef,
  };
}

function secretServiceName(ref: string): string {
  const service = ref.startsWith('keychain:') ? ref.slice('keychain:'.length) : ref;
  const safe = service.trim().replace(/[^A-Za-z0-9._-]+/g, '_');
  if (!safe) {
    throw new Error('Invalid keychain service name');
  }
  return safe;
}

async function defaultReadSecret(
  ref: string,
  root: string,
  preferFileStore: boolean,
): Promise<string | null> {
  const service = secretServiceName(ref);
  if (process.platform === 'darwin' && !preferFileStore) {
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
): Promise<void> {
  const service = secretServiceName(ref);
  if (process.platform === 'darwin' && !preferFileStore) {
    try {
      await writeMacKeychain(service, secret);
      return;
    } catch {
      // Locked or headless keychain must not block a remote shell updating Host keys.
    }
  }
  await writeFileSecret(root, service, secret);
}

/**
 * macOS keychain via `security find-generic-password -w -s <service>`.
 * apiKeyRef format: `keychain:<service>` or bare service name.
 */
async function readMacKeychain(service: string): Promise<string | null> {
  return new Promise((resolve) => {
    const child = spawn('security', ['find-generic-password', '-w', '-s', service], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.on('error', () => resolve(null));
    child.on('close', (code) => {
      if (code !== 0) {
        resolve(null);
        return;
      }
      const value = stdout.trim();
      resolve(value.length > 0 ? value : null);
    });
  });
}

async function writeMacKeychain(service: string, secret: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      'security',
      ['add-generic-password', '-U', '-a', 'piwin', '-s', service, '-w', secret],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.on('error', (error) => {
      reject(error);
    });
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(stderr.trim() || `keychain write failed (exit ${code ?? 'unknown'})`));
    });
  });
}

function secretFilePath(root: string, service: string): string {
  return join(root, 'secrets', service);
}

async function readFileSecret(root: string, service: string): Promise<string | null> {
  try {
    const raw = await readFile(secretFilePath(root, service), 'utf8');
    const value = raw.trim();
    return value.length > 0 ? value : null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

async function writeFileSecret(root: string, service: string, secret: string): Promise<void> {
  const dir = join(root, 'secrets');
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const file = secretFilePath(root, service);
  await writeFile(file, secret, { encoding: 'utf8', mode: 0o600 });
  await chmod(file, 0o600);
  await chmod(dir, 0o700);
}

/** @deprecated Use createSecretResolver write path; kept for existing imports. */
export async function defaultWriteKeychain(ref: string, secret: string): Promise<void> {
  await defaultWriteSecret(ref, secret, getPiwinRoot(), false);
}
