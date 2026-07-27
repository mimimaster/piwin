/**
 * Resolve provider secrets without logging values.
 * Precedence: apiKeyRef (keychain) → apiKeyEnv → error.
 */
import { spawn } from 'node:child_process';
import type { ModelProviderConfig } from '@piwin/contracts';

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
};

export type CreateSecretResolverOptions = {
  env?: NodeJS.ProcessEnv;
  /** Injected keychain lookup for tests / non-macOS. */
  readKeychain?: (ref: string) => Promise<string | null>;
  /** Injected keychain write for tests / non-macOS. */
  writeKeychain?: (ref: string, secret: string) => Promise<void>;
};

export function createSecretResolver(
  options: CreateSecretResolverOptions = {},
): SecretResolver {
  const env = options.env ?? process.env;
  const readKeychain = options.readKeychain ?? defaultReadKeychain;
  const writeKeychain = options.writeKeychain ?? defaultWriteKeychain;

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

  async function reportProviderSecret(
    provider: ModelProviderConfig,
  ): Promise<SecretResolveReport> {
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
        detail: error instanceof Error ? error.message : String(error),
      };
    }
  }

  return { resolveProviderSecret, reportProviderSecret, writeProviderSecret, readProviderSecret };
}

/**
 * macOS keychain via `security find-generic-password -w -s <service>`.
 * apiKeyRef format: `keychain:<service>` or bare service name.
 * Other platforms: returns null (env-only MVP).
 */
async function defaultReadKeychain(ref: string): Promise<string | null> {
  if (process.platform !== 'darwin') {
    return null;
  }
  const service = ref.startsWith('keychain:') ? ref.slice('keychain:'.length) : ref;
  if (!service.trim()) {
    return null;
  }
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

/**
 * macOS keychain write via `security add-generic-password -U`.
 * Other platforms: throw (env-only MVP until cross-platform secret store ships).
 */
async function defaultWriteKeychain(ref: string, secret: string): Promise<void> {
  if (process.platform !== 'darwin') {
    throw new Error(
      'Storing API keys requires macOS keychain in this build. Use an environment variable name instead.',
    );
  }
  const service = ref.startsWith('keychain:') ? ref.slice('keychain:'.length) : ref;
  if (!service.trim()) {
    throw new Error('Invalid keychain service name');
  }
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
