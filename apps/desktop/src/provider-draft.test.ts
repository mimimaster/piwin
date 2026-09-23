import { describe, expect, it } from 'vitest';
import {
  draftToProvider,
  isConnectionDirty,
  mergeConnectionDraft,
  pendingApiKey,
  providerToDraft,
  resolveDefaultAfterProviderChange,
  withProviders,
} from './provider-draft.js';
import type { ModelProviderConfig, PiwinConfig } from '@piwin/contracts';

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

  it('treats a revealed saved key as no new key', () => {
    const draft = providerToDraft(makeProvider({ id: 'a', apiKeyRef: 'ref-1' }));
    expect(pendingApiKey({ ...draft, apiKeyInput: 'sk-saved', revealedApiKey: 'sk-saved' })).toBe('');
    expect(pendingApiKey({ ...draft, apiKeyInput: 'sk-new ', revealedApiKey: 'sk-saved' })).toBe(
      'sk-new',
    );
    expect(pendingApiKey({ ...draft, apiKeyInput: 'sk-typed' })).toBe('sk-typed');
  });

  it('reports a connection as dirty only when it differs from the saved provider', () => {
    const saved = makeProvider({ id: 'a', apiKeyRef: 'ref-1', headers: { 'X-A': '1' } });
    const draft = providerToDraft(saved);
    expect(isConnectionDirty(draft, saved)).toBe(false);
    expect(isConnectionDirty({ ...draft, baseUrl: 'https://other.example/v1' }, saved)).toBe(true);
    expect(isConnectionDirty({ ...draft, apiKeyInput: 'sk-x', revealedApiKey: 'sk-x' }, saved)).toBe(
      false,
    );
    expect(isConnectionDirty({ ...draft, apiKeyInput: 'sk-new' }, saved)).toBe(true);
    // Legacy configs carry both refs; the draft drops the env one, which is not an edit.
    const legacy = makeProvider({ id: 'b', apiKeyRef: 'ref-2', apiKeyEnv: 'OLD_ENV' });
    expect(isConnectionDirty(providerToDraft(legacy), legacy)).toBe(false);
  });

  it('merges a connection draft onto the current models and enable state', () => {
    const opened = makeProvider({ id: 'a', models: [{ id: 'm1' }] });
    const draft = { ...providerToDraft(opened), baseUrl: 'https://new.example/v1' };
    const current = { ...opened, enabled: false, models: [{ id: 'm1' }, { id: 'm2' }] };
    const merged = mergeConnectionDraft(draft, current);
    expect(merged.baseUrl).toBe('https://new.example/v1');
    expect(merged.enabled).toBe(false);
    expect(merged.models.map((model) => model.id)).toEqual(['m1', 'm2']);
  });

  it('re-resolves the default when the provider list changes', () => {
    const config = {
      hostMode: 'sdk',
      defaultProviderId: 'a',
      defaultModelId: 'model-a',
      providers: [makeProvider({ id: 'a' }), makeProvider({ id: 'b', models: [{ id: 'model-b' }] })],
    } as unknown as PiwinConfig;
    const next = withProviders(config, [makeProvider({ id: 'b', models: [{ id: 'model-b' }] })]);
    expect(next.defaultProviderId).toBe('b');
    expect(next.defaultModelId).toBe('model-b');
    expect(withProviders(config, []).defaultProviderId).toBeUndefined();
  });

  it('preserves imageGeneration.defaultModel when provider or model is disabled', () => {
    const config = {
      hostMode: 'sdk',
      providers: [
        makeProvider({
          id: 'grok',
          enabled: false,
          models: [{ id: 'grok-imagine-image', capabilities: ['image-generation'], enabled: false }],
        }),
      ],
      imageGeneration: {
        defaultModel: {
          protocol: 'openai-compatible',
          providerId: 'grok',
          modelId: 'grok-imagine-image',
        },
      },
    } as unknown as PiwinConfig;

    const next = withProviders(config, config.providers);
    expect(next.imageGeneration?.defaultModel).toEqual({
      protocol: 'openai-compatible',
      providerId: 'grok',
      modelId: 'grok-imagine-image',
    });
  });

  it('cleans up imageGeneration.defaultModel when provider or model is deleted', () => {
    const config = {
      hostMode: 'sdk',
      providers: [
        makeProvider({
          id: 'grok',
          models: [{ id: 'grok-imagine-image', capabilities: ['image-generation'] }],
        }),
      ],
      imageGeneration: {
        defaultModel: {
          protocol: 'openai-compatible',
          providerId: 'grok',
          modelId: 'grok-imagine-image',
        },
      },
    } as unknown as PiwinConfig;

    // Provider deleted
    const withoutProvider = withProviders(config, []);
    expect(withoutProvider.imageGeneration?.defaultModel).toBeUndefined();

    // Model deleted
    const withoutModel = withProviders(config, [
      makeProvider({ id: 'grok', models: [{ id: 'other-model' }] }),
    ]);
    expect(withoutModel.imageGeneration?.defaultModel).toBeUndefined();
  });
});
