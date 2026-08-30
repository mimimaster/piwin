import { describe, expect, it } from 'vitest';
import type { ModelProviderConfig, ModelRef, PiwinConfig } from '@piwin/contracts';
import { createDefaultWalkthroughConfig } from '@piwin/contracts';
import { resolveProviderForModel } from './completion-model-resolution.js';

const MODEL: ModelRef = {
  protocol: 'openai-compatible',
  providerId: 'prov',
  modelId: 'model-a',
};

function createProvider(overrides: Partial<ModelProviderConfig> = {}): ModelProviderConfig {
  return {
    id: 'prov',
    name: 'Test provider',
    protocol: 'openai-compatible',
    baseUrl: 'https://api.example.com/v1',
    apiKeyEnv: 'TEST_KEY',
    models: [{ id: 'model-a' }],
    ...overrides,
  };
}

function createConfig(
  overrides: {
    providers?: ModelProviderConfig[];
    defaultProviderId?: string;
    defaultModelId?: string;
  } = {},
): PiwinConfig {
  return {
    hostMode: 'sdk',
    agentMock: false,
    providers: overrides.providers ?? [createProvider()],
    media: { maxPasteBytes: 1024, allowedMimeTypes: [] },
    artifact: {
      enabled: true,
      triggerMode: 'automatic',
      decisionPrompt: { mode: 'default', customPrompt: '' },
      maxBytes: 1024,
    },
    walkthrough: createDefaultWalkthroughConfig(),
    ...(overrides.defaultProviderId ? { defaultProviderId: overrides.defaultProviderId } : {}),
    ...(overrides.defaultModelId ? { defaultModelId: overrides.defaultModelId } : {}),
  };
}

describe('resolveProviderForModel', () => {
  it('returns the enabled provider when the model ref is valid', () => {
    const config = createConfig();
    const resolved = resolveProviderForModel(MODEL, config);
    expect('provider' in resolved).toBe(true);
    if ('provider' in resolved) {
      expect(resolved.provider.id).toBe('prov');
    }
  });

  it('returns provider-not-found for an unknown provider', () => {
    const resolved = resolveProviderForModel({ ...MODEL, providerId: 'missing' }, createConfig());
    expect(resolved).toEqual({ error: 'provider-not-found' });
  });

  it('returns unsupported-provider when the protocol does not match', () => {
    const resolved = resolveProviderForModel(
      { ...MODEL, protocol: 'anthropic-compatible' },
      createConfig(),
    );
    expect(resolved).toEqual({ error: 'unsupported-provider' });
  });

  it('returns model-not-configured when the model id is missing', () => {
    const resolved = resolveProviderForModel({ ...MODEL, modelId: 'nope' }, createConfig());
    expect(resolved).toEqual({ error: 'model-not-configured' });
  });
});
