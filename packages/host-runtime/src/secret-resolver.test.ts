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

  it('writes secrets via injected keychain and returns apiKeyRef', async () => {
    const stored = new Map<string, string>();
    const resolver = createSecretResolver({
      writeKeychain: async (ref, secret) => {
        stored.set(ref, secret);
      },
      readKeychain: async (ref) => stored.get(ref) ?? null,
    });
    const apiKeyRef = await resolver.writeProviderSecret('cpa', '123456');
    expect(apiKeyRef).toBe('keychain:piwin-cpa');
    const value = await resolver.resolveProviderSecret({
      ...provider,
      id: 'cpa',
      apiKeyRef,
    });
    expect(value).toBe('123456');
  });

  it('reports missing when unset', async () => {
    const resolver = createSecretResolver({ env: {} });
    const report = await resolver.reportProviderSecret(provider);
    expect(report.status).toBe('missing');
  });

  it('persists shell-updated keys in the Host file store', async () => {
    const { mkdtemp, readFile } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const root = await mkdtemp(join(tmpdir(), 'piwin-secrets-'));
    const resolver = createSecretResolver({
      piwinRoot: root,
      preferFileStore: true,
    });
    const apiKeyRef = await resolver.writeProviderSecret('custom-openai', 'cliproxy-new-key');
    expect(apiKeyRef).toBe('keychain:piwin-custom-openai');
    const stored = await readFile(join(root, 'secrets', 'piwin-custom-openai'), 'utf8');
    expect(stored).toBe('cliproxy-new-key');
    const value = await resolver.resolveProviderSecret({
      ...provider,
      id: 'custom-openai',
      apiKeyRef,
    });
    expect(value).toBe('cliproxy-new-key');
  });
});
