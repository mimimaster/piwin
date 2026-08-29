import { describe, expect, it } from 'vitest';
import type { ModelProviderConfig, ModelRef, PiwinConfig } from '@piwin/contracts';
import { createDefaultWalkthroughConfig } from '@piwin/contracts';
import {
  resolveFlashcardSelectionCompletionModel,
  resolveProviderForModel,
} from './completion-model-resolution.js';

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

describe('resolveFlashcardSelectionCompletionModel', () => {
  it('prefers a valid command-provided model', () => {
    const other: ModelRef = { ...MODEL, modelId: 'model-b' };
    const config = createConfig({
      providers: [createProvider({ models: [{ id: 'model-a' }, { id: 'model-b' }] })],
      defaultProviderId: 'prov',
      defaultModelId: 'model-a',
    });
    const resolved = resolveFlashcardSelectionCompletionModel({
      config,
      model: other,
      sessionId: 'sess-1',
      resolveSessionModel: () => MODEL,
    });
    expect('model' in resolved).toBe(true);
    if ('model' in resolved) {
      expect(resolved.model.modelId).toBe('model-b');
    }
  });

  it('does not fall through when an explicit command model is invalid', () => {
    const config = createConfig({ defaultProviderId: 'prov', defaultModelId: 'model-a' });
    const resolved = resolveFlashcardSelectionCompletionModel({
      config,
      model: { ...MODEL, modelId: 'missing' },
      resolveSessionModel: () => MODEL,
      sessionId: 'sess-1',
    });
    expect(resolved).toEqual({ error: 'flashcard-selection-model-unavailable' });
  });

  it('uses the session model when no command model is provided', () => {
    const sessionModel: ModelRef = { ...MODEL, modelId: 'model-b' };
    const config = createConfig({
      providers: [createProvider({ models: [{ id: 'model-a' }, { id: 'model-b' }] })],
      defaultProviderId: 'prov',
      defaultModelId: 'model-a',
    });
    const resolved = resolveFlashcardSelectionCompletionModel({
      config,
      sessionId: 'sess-1',
      resolveSessionModel: () => sessionModel,
    });
    expect('model' in resolved).toBe(true);
    if ('model' in resolved) {
      expect(resolved.model.modelId).toBe('model-b');
    }
  });

  it('uses the configured default chat model when session model is absent', () => {
    const config = createConfig({ defaultProviderId: 'prov', defaultModelId: 'model-a' });
    const resolved = resolveFlashcardSelectionCompletionModel({
      config,
      sessionId: 'sess-1',
      resolveSessionModel: () => undefined,
    });
    expect('model' in resolved).toBe(true);
    if ('model' in resolved) {
      expect(resolved.model.modelId).toBe('model-a');
    }
  });

  it('does not pick an arbitrary provider when nothing is configured', () => {
    const config = createConfig();
    const resolved = resolveFlashcardSelectionCompletionModel({
      config,
      resolveSessionModel: () => undefined,
    });
    expect(resolved).toEqual({ error: 'flashcard-selection-model-unavailable' });
  });

  it('rejects a provider with an empty base URL', () => {
    const config = createConfig({
      providers: [createProvider({ baseUrl: '   ' })],
      defaultProviderId: 'prov',
      defaultModelId: 'model-a',
    });
    const resolved = resolveFlashcardSelectionCompletionModel({
      config,
      model: MODEL,
      resolveSessionModel: () => undefined,
    });
    expect(resolved).toEqual({ error: 'flashcard-selection-model-unavailable' });
  });
});
