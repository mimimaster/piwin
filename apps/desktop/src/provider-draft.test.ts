import { describe, expect, it } from 'vitest';
import {
  draftToProvider,
  providerToDraft,
  resolveDefaultAfterProviderChange,
} from './provider-draft.js';
import type { ModelProviderConfig } from '@piwin/contracts';

function makeProvider(partial: Partial<ModelProviderConfig> & { id: string }): ModelProviderConfig {
  return {
    protocol: 'openai-compatible',
    name: partial.name ?? partial.id,
    baseUrl: 'https://api.example.com/v1',
    models: partial.models ?? [{ id: 'model-a' }],
    ...partial,
  } as ModelProviderConfig;
}

describe('provider-draft', () => {
  it('draftToProvider never serializes the raw API key input', () => {
    const draft = providerToDraft(makeProvider({ id: 'a', apiKeyRef: 'ref-123' }));
    draft.apiKeyInput = 'raw-api-key';
    const provider = draftToProvider(draft);
    expect(provider.apiKeyRef).toBe('ref-123');
    expect((provider as { apiKeyInput?: string }).apiKeyInput).toBeUndefined();
  });

  it('treats a keychain ref as the single authoritative key source', () => {
    const provider = makeProvider({
      id: 'a',
      apiKeyEnv: 'STALE_API_KEY_ENV',
      apiKeyRef: 'ref-123',
    });
    const draft = providerToDraft(provider);
    expect(draft.storedApiKeyEnv).toBe('');

    const saved = draftToProvider(draft);
    expect(saved.apiKeyRef).toBe('ref-123');
    expect(saved.apiKeyEnv).toBeUndefined();
  });

  it('providerToDraft preserves enabled and apiKeyRef', () => {
    const provider = makeProvider({ id: 'a', enabled: false, apiKeyRef: 'ref-123' });
    const draft = providerToDraft(provider);
    expect(draft.enabled).toBe(false);
    expect(draft.storedApiKeyRef).toBe('ref-123');
  });

  it('resolveDefaultAfterProviderChange keeps current default when still enabled', () => {
    const providers = [makeProvider({ id: 'a', enabled: false }), makeProvider({ id: 'b' })];
    const result = resolveDefaultAfterProviderChange(providers, {
      providerId: 'b',
      modelId: 'model-a',
    });
    expect(result).toEqual({ defaultProviderId: 'b', defaultModelId: 'model-a' });
  });

  it('resolveDefaultAfterProviderChange falls back to first enabled provider/model', () => {
    const providers = [
      makeProvider({ id: 'a', enabled: false }),
      makeProvider({ id: 'b', models: [{ id: 'b-1' }] }),
    ];
    const result = resolveDefaultAfterProviderChange(providers, {
      providerId: 'a',
      modelId: 'b-1',
    });
    expect(result).toEqual({ defaultProviderId: 'b', defaultModelId: 'b-1' });
  });

  it('resolveDefaultAfterProviderChange returns empty when nothing is enabled', () => {
    const providers = [makeProvider({ id: 'a', enabled: false })];
    const result = resolveDefaultAfterProviderChange(providers, {
      providerId: 'a',
      modelId: 'model-a',
    });
    expect(result).toEqual({});
  });
});
