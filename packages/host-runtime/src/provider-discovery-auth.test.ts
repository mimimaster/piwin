import { describe, expect, it } from 'vitest';
import type { ModelProviderConfig } from '@piwin/contracts';
import {
  mergeProviderSecretSource,
  resolveProviderCallSecret,
} from './provider-discovery-auth.js';

function provider(overrides: Partial<ModelProviderConfig> = {}): ModelProviderConfig {
  return {
    id: 'custom-openai',
    name: 'Cpa',
    protocol: 'openai-compatible',
    baseUrl: 'http://127.0.0.1:8317/v1',
    models: [],
    ...overrides,
  };
}

describe('mergeProviderSecretSource', () => {
  it('restores apiKeyRef when the settings shell omitted the ref', () => {
    const merged = mergeProviderSecretSource(
      provider(),
      provider({ apiKeyRef: 'keychain:piwin-custom-openai' }),
    );
    expect(merged.apiKeyRef).toBe('keychain:piwin-custom-openai');
  });

  it('lets Host-persisted refs win over a remote-shell projection', () => {
    const merged = mergeProviderSecretSource(
      provider({ apiKeyRef: 'keychain:draft' }),
      provider({ apiKeyRef: 'keychain:disk' }),
    );
    expect(merged.apiKeyRef).toBe('keychain:disk');
  });

  it('restores secrets when the remote shell sent a stripped provider row', () => {
    const stripped = provider();
    expect(stripped.apiKeyRef).toBeUndefined();
    const merged = mergeProviderSecretSource(
      stripped,
      provider({ apiKeyRef: 'keychain:piwin-custom-openai', apiKeyEnv: 'CPA_API_KEY' }),
    );
    expect(merged.apiKeyRef).toBe('keychain:piwin-custom-openai');
    expect(merged.apiKeyEnv).toBe('CPA_API_KEY');
    expect(merged.baseUrl).toBe('http://127.0.0.1:8317/v1');
  });

  it('ignores the remote [stored-secret] placeholder', () => {
    const merged = mergeProviderSecretSource(
      provider({ apiKeyRef: '[stored-secret]', apiKeyEnv: '[stored-secret]' }),
      provider({ apiKeyRef: 'keychain:piwin-custom-openai' }),
    );
    expect(merged.apiKeyRef).toBe('keychain:piwin-custom-openai');
    expect(merged.apiKeyEnv).toBeUndefined();
  });
});

describe('resolveProviderCallSecret', () => {
  it('does not send auth when no key is configured (local no-auth)', async () => {
    const secret = await resolveProviderCallSecret({
      provider: provider(),
      resolveSecret: async () => {
        throw new Error('should not resolve');
      },
    });
    expect(secret).toBeNull();
  });

  it('does not swallow a missing configured key', async () => {
    await expect(
      resolveProviderCallSecret({
        provider: provider({ apiKeyRef: 'keychain:piwin-custom-openai' }),
        resolveSecret: async () => {
          throw new Error('Provider custom-openai: API key is configured but could not be resolved');
        },
      }),
    ).rejects.toThrow(/could not be resolved/);
  });

  it('prefers a one-shot key over keychain', async () => {
    const secret = await resolveProviderCallSecret({
      provider: provider({ apiKeyRef: 'keychain:piwin-custom-openai' }),
      oneShotApiKey: ' pasted-key ',
      resolveSecret: async () => {
        throw new Error('should not resolve');
      },
    });
    expect(secret).toBe('pasted-key');
  });
});
