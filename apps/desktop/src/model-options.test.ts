import { describe, expect, it } from 'vitest';
import {
  buildEnabledModelOptions,
  isComposerChatModel,
  modelOptionsFromConfiguredModels,
  readConfiguredChatModelsData,
} from './model-options.js';
import type { ModelConfigEntry, ModelProviderConfig } from '@piwin/contracts';

function makeProvider(
  partial: Partial<ModelProviderConfig> & { id: string },
): ModelProviderConfig {
  return {
    protocol: 'openai-compatible',
    name: partial.name ?? partial.id,
    baseUrl: 'https://api.example.com/v1',
    models: partial.models ?? [{ id: 'model-a' }],
    ...partial,
  } as ModelProviderConfig;
}

function makeModel(partial: Partial<ModelConfigEntry> & { id: string }): ModelConfigEntry {
  return { ...partial, id: partial.id } as ModelConfigEntry;
}

describe('buildEnabledModelOptions', () => {
  it('excludes every model of a disabled provider, even enabled models', () => {
    // Regression: composerProfile.model pointed at a disabled provider's model
    // (custom-openai-2/grok-4.5), which the host never registered, so the
    // session threw "Configured model is unavailable".
    const providers = [
      makeProvider({
        id: 'custom-openai-2',
        name: 'xGrok',
        enabled: false,
        models: [makeModel({ id: 'grok-4.5', enabled: true })],
      }),
    ];
    expect(buildEnabledModelOptions(providers)).toEqual([]);
  });

  it('excludes disabled models while keeping enabled siblings of the same provider', () => {
    const providers = [
      makeProvider({
        id: 'p1',
        models: [
          makeModel({ id: 'off-model', enabled: false }),
          makeModel({ id: 'on-model' }),
        ],
      }),
    ];
    const options = buildEnabledModelOptions(providers);
    expect(options).toHaveLength(1);
    expect(options[0]).toMatchObject({ providerId: 'p1', modelId: 'on-model' });
  });

  it('treats a provider without an enabled flag as enabled (default true)', () => {
    const providers = [makeProvider({ id: 'p1' })];
    const options = buildEnabledModelOptions(providers);
    expect(options).toHaveLength(1);
    expect(options[0]).toMatchObject({ providerId: 'p1', modelId: 'model-a' });
  });

  it('builds labels as "ProviderName / ModelLabel" with model-id fallback', () => {
    const providers = [
      makeProvider({
        id: 'p1',
        name: 'Anthropic',
        protocol: 'anthropic-compatible',
        models: [
          makeModel({ id: 'claude-sonnet', label: 'Claude Sonnet' }),
          makeModel({ id: 'claude-opus' }),
        ],
      }),
    ];
    const options = buildEnabledModelOptions(providers);
    expect(options.map((option) => option.label)).toEqual([
      'Anthropic / Claude Sonnet',
      'Anthropic / claude-opus',
    ]);
    expect(options[0]?.protocol).toBe('anthropic-compatible');
  });

  it('carries derived flags from the model entry', () => {
    const providers = [
      makeProvider({
        id: 'p1',
        protocol: 'google-gemini',
        models: [
          makeModel({
            id: 'gemini-pro',
            contextWindow: 1_000_000,
            maxOutputTokens: 32_000,
            thinkingLevel: 'low',
            thinkingLevels: ['off', 'low'],
            reasoning: true,
            input: ['text', 'image'],
            capabilities: ['chat', 'image-generation'],
          }),
        ],
      }),
    ];
    expect(buildEnabledModelOptions(providers)).toEqual([
      {
        providerId: 'p1',
        protocol: 'google-gemini',
        modelId: 'gemini-pro',
        label: 'p1 / gemini-pro',
        contextWindow: 1_000_000,
        maxOutputTokens: 32_000,
        thinkingLevel: 'low',
        thinkingLevels: ['off', 'low'],
        reasoning: true,
        supportsImage: true,
        supportsImageGeneration: true,
      },
    ]);
  });

  it('blocks only pure image/video/speech models, keeping chat and web-search models', () => {
    const providers = [
      makeProvider({
        id: 'p1',
        models: [
          makeModel({ id: 'chat-model' }),
          makeModel({ id: 'gpt-image-1', capabilities: ['image-generation'] }),
          makeModel({ id: 'sora-2', capabilities: ['video-generation'] }),
          makeModel({ id: 'whisper-1', capabilities: ['speech-to-text'] }),
          makeModel({ id: 'tts-1', capabilities: ['text-to-speech'] }),
          // Regression: native-web-search implies the chat surface; a model
          // tagged only for provider-native search must stay in the picker.
          makeModel({ id: 'search-model', capabilities: ['native-web-search'] }),
          makeModel({
            id: 'hybrid',
            capabilities: ['chat', 'image-generation'],
          }),
          makeModel({
            id: 'image-and-video-only',
            capabilities: ['image-generation', 'video-generation'],
          }),
        ],
      }),
    ];
    const options = buildEnabledModelOptions(providers);
    expect(options.map((option) => option.modelId)).toEqual([
      'chat-model',
      'search-model',
      'hybrid',
    ]);
  });

  it('isComposerChatModel blocks only pure auxiliary models', () => {
    // Omitted capabilities default to chat.
    expect(isComposerChatModel(makeModel({ id: 'legacy' }))).toBe(true);
    expect(isComposerChatModel(makeModel({ id: 'explicit-chat', capabilities: ['chat'] }))).toBe(
      true,
    );
    // native-web-search implies the chat surface (contracts semantics).
    expect(
      isComposerChatModel(makeModel({ id: 'search', capabilities: ['native-web-search'] })),
    ).toBe(true);
    // Hybrids that also declare chat stay available.
    expect(
      isComposerChatModel(
        makeModel({ id: 'hybrid', capabilities: ['chat', 'image-generation'] }),
      ),
    ).toBe(true);
    // Pure auxiliary models are blocked.
    expect(
      isComposerChatModel(makeModel({ id: 'image-only', capabilities: ['image-generation'] })),
    ).toBe(false);
    expect(
      isComposerChatModel(makeModel({ id: 'video-only', capabilities: ['video-generation'] })),
    ).toBe(false);
    expect(
      isComposerChatModel(makeModel({ id: 'asr-only', capabilities: ['speech-to-text'] })),
    ).toBe(false);
    expect(
      isComposerChatModel(makeModel({ id: 'tts-only', capabilities: ['text-to-speech'] })),
    ).toBe(false);
  });

  it('returns an empty list for no providers or a null-free empty array', () => {
    expect(buildEnabledModelOptions([])).toEqual([]);
  });

  it('skips disabled providers even when they appear first in the list', () => {
    const providers = [
      makeProvider({ id: 'disabled-first', enabled: false }),
      makeProvider({ id: 'enabled-second' }),
    ];
    const options = buildEnabledModelOptions(providers);
    expect(options).toHaveLength(1);
    expect(options[0]).toMatchObject({ providerId: 'enabled-second' });
  });
});

describe('modelOptionsFromConfiguredModels', () => {
  it('maps the secret-free Host list into composer options', () => {
    expect(
      modelOptionsFromConfiguredModels([
        {
          providerId: 'custom-openai',
          protocol: 'openai-compatible',
          modelId: 'deepseek-v4-flash',
          label: 'DeepSeek',
          reasoning: true,
        },
        {
          providerId: 'anthropic',
          protocol: 'anthropic-compatible',
          modelId: 'claude-sonnet',
        },
      ]),
    ).toEqual([
      {
        providerId: 'custom-openai',
        protocol: 'openai-compatible',
        modelId: 'deepseek-v4-flash',
        label: 'custom-openai / DeepSeek',
        reasoning: true,
      },
      {
        providerId: 'anthropic',
        protocol: 'anthropic-compatible',
        modelId: 'claude-sonnet',
        label: 'anthropic / claude-sonnet',
      },
    ]);
  });
});

describe('readConfiguredChatModelsData', () => {
  it('keeps defaults and drops unknown protocols', () => {
    const data = readConfiguredChatModelsData({
      defaultProviderId: 'custom-openai',
      defaultModelId: 'deepseek-v4-flash',
      models: [
        {
          providerId: 'custom-openai',
          protocol: 'openai-compatible',
          modelId: 'deepseek-v4-flash',
          label: 'DeepSeek',
        },
        { providerId: 'bad', protocol: 'mystery', modelId: 'x' },
      ],
    });
    expect(data).toEqual({
      defaultProviderId: 'custom-openai',
      defaultModelId: 'deepseek-v4-flash',
      models: [
        {
          providerId: 'custom-openai',
          protocol: 'openai-compatible',
          modelId: 'deepseek-v4-flash',
          label: 'DeepSeek',
        },
      ],
    });
  });
});
