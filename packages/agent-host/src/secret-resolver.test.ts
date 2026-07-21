import { describe, expect, it } from 'vitest';
import type { ModelProviderConfig } from '@piwin/contracts';
import { createSecretResolver } from './secret-resolver.js';

const provider: ModelProviderConfig = {
  id: 'openai',
  protocol: 'openai-compatible',
  name: 'OpenAI',
  baseUrl: 'https://api.openai.com/v1',
  apiKeyEnv: 'TEST_OPENAI_KEY',
  models: [{ id: 'gpt-4o' }],
};

describe('createSecretResolver', () => {
  it('resolves from env and never requires printing secrets', async () => {
    const resolver = createSecretResolver({
      env: { TEST_OPENAI_KEY: 'secret-value-not-logged' },
    });
    const value = await resolver.resolveProviderSecret(provider);
    expect(value).toBe('secret-value-not-logged');
    const report = await resolver.reportProviderSecret(provider);
    expect(report).toEqual({
      providerId: 'openai',
      status: 'ok',
      source: 'env',
    });
  });

  it('prefers keychain ref over env', async () => {
    const resolver = createSecretResolver({
      env: { TEST_OPENAI_KEY: 'from-env' },
      readKeychain: async () => 'from-keychain',
    });
    const value = await resolver.resolveProviderSecret({
      ...provider,
      apiKeyRef: 'keychain:piwin-openai',
    });
    expect(value).toBe('from-keychain');
    const report = await resolver.reportProviderSecret({
      ...provider,
      apiKeyRef: 'keychain:piwin-openai',
    });
    expect(report.source).toBe('keychain');
  });

  it('reports missing when unset', async () => {
    const resolver = createSecretResolver({ env: {} });
    const report = await resolver.reportProviderSecret(provider);
    expect(report.status).toBe('missing');
  });
});
