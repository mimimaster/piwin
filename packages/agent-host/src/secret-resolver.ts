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
};

export type CreateSecretResolverOptions = {
  env?: NodeJS.ProcessEnv;
  /** Injected keychain lookup for tests / non-macOS. */
  readKeychain?: (ref: string) => Promise<string | null>;
};

export function createSecretResolver(
  options: CreateSecretResolverOptions = {},
): SecretResolver {
  const env = options.env ?? process.env;
  const readKeychain = options.readKeychain ?? defaultReadKeychain;

  async function resolveProviderSecret(provider: ModelProviderConfig): Promise<string> {
    if (provider.apiKeyRef?.trim()) {
      const fromRef = await readKeychain(provider.apiKeyRef.trim());
      if (fromRef && fromRef.length > 0) {
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
      `No API key for provider ${provider.id}: set apiKeyEnv or apiKeyRef (keychain)`,
    );
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

  return { resolveProviderSecret, reportProviderSecret };
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
