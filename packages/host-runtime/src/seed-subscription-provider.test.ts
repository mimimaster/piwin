import { describe, expect, it } from 'vitest';
import { projectConfiguredChatModels } from '@piwin/contracts';
import { createDefaultPiwinConfig } from './config-store.js';
import {
  catalogModelToConfigEntry,
  ensureSubscriptionProviders,
  upsertSubscriptionProvider,
} from './seed-subscription-provider.js';

describe('seed subscription provider', () => {
  it('creates a Models-page provider from the OAuth catalog', () => {
    const config = createDefaultPiwinConfig();
    const next = upsertSubscriptionProvider(config, 'openai-codex', [
      { id: 'gpt-5.4-codex', name: 'GPT-5.4 Codex', reasoning: true },
    ]);
    expect(next.providers[0]).toMatchObject({
      id: 'openai-codex',
      name: 'ChatGPT Codex',
      protocol: 'openai-compatible',
      baseUrl: 'oauth://openai-codex',
      source: 'subscription',
    });
    expect(next.providers[0]?.models[0]).toEqual({
      id: 'gpt-5.4-codex',
      label: 'GPT-5.4 Codex',
      category: 'package',
      capabilities: ['chat'],
      reasoning: true,
    });
    expect(next.providers[0]?.models.map((model) => model.id)).toEqual([
      'gpt-5.4-codex',
      'gpt-image-2',
      'gpt-image-2.5-sunburst',
      'gpt-image-2.5-flare',
    ]);
    expect(next.providers[0]?.models.find((model) => model.id === 'gpt-image-2')).toMatchObject({
      capabilities: ['image-generation'],
      routes: { 'image-generation': { path: '/codex/images/generations', apiStyle: 'openai' } },
    });
  });

  it('keeps user enable/params and does not overwrite a BYOK channel', () => {
    const config = createDefaultPiwinConfig();
    config.providers = [
      {
        id: 'openai-codex',
        name: 'ChatGPT Codex',
        protocol: 'openai-compatible',
        baseUrl: 'oauth://openai-codex',
        source: 'subscription',
        models: [{ id: 'gpt-5.4-codex', label: 'Codex', enabled: false, contextWindow: 200_000 }],
      },
    ];
    const merged = upsertSubscriptionProvider(config, 'openai-codex', [
      { id: 'gpt-5.4-codex', name: 'GPT-5.4 Codex' },
      { id: 'gpt-5.4', name: 'GPT-5.4' },
    ]);
    expect(merged.providers[0]?.models.slice(0, 2)).toEqual([
      {
        id: 'gpt-5.4-codex',
        label: 'Codex',
        category: 'package',
        capabilities: ['chat'],
        enabled: false,
        contextWindow: 200_000,
      },
      catalogModelToConfigEntry({ id: 'gpt-5.4', name: 'GPT-5.4' }),
    ]);
    expect(merged.providers[0]?.models.some((model) => model.id === 'gpt-image-2')).toBe(true);

    const channel = createDefaultPiwinConfig();
    channel.providers = [
      {
        id: 'xai',
        name: 'xAI key',
        protocol: 'openai-compatible',
        baseUrl: 'https://api.x.ai/v1',
        models: [{ id: 'grok-4.6' }],
      },
    ];
    expect(upsertSubscriptionProvider(channel, 'xai', [{ id: 'grok-4.6', name: 'Grok 4.6' }])).toBe(
      channel,
    );
  });

  it('replaces the default 128K window with the subscription catalog window', () => {
    const config = createDefaultPiwinConfig();
    config.providers = [
      {
        id: 'xai',
        name: 'Grok',
        protocol: 'openai-compatible',
        baseUrl: 'oauth://xai',
        source: 'subscription',
        models: [{ id: 'grok-4.6', label: 'Grok 4.6', contextWindow: 128_000, maxOutputTokens: 8_192 }],
      },
    ];
    const merged = upsertSubscriptionProvider(config, 'xai', [
      { id: 'grok-4.6', name: 'Grok 4.6', contextWindow: 500_000, maxOutputTokens: 500_000 },
    ]);
    expect(merged.providers[0]?.models[0]).toEqual({
      id: 'grok-4.6',
      label: 'Grok 4.6',
      category: 'package',
      capabilities: ['chat'],
      contextWindow: 500_000,
      maxOutputTokens: 500_000,
    });
    expect(merged.providers[0]?.models.map((model) => model.id)).toContain('grok-imagine-image-2.0');
    expect(merged.providers[0]?.models.map((model) => model.id)).toContain('grok-imagine-video');
  });

  it('seeds every logged-in v1 account', () => {
    const config = createDefaultPiwinConfig();
    const next = ensureSubscriptionProviders(
      config,
      [
        { providerId: 'xai', surface: 'v1', state: 'logged-in' },
        { providerId: 'openai-codex', surface: 'v1', state: 'logged-out' },
      ],
      (id) => (id === 'xai' ? [{ id: 'grok-4.6', name: 'Grok 4.6' }] : []),
    );
    expect(next.providers.map((provider) => provider.id)).toEqual(['xai']);
    expect(next.providers[0]?.source).toBe('subscription');
  });

  it('tags newly seen Grok subscription chat models for native search, keeping saved choices', () => {
    const config = createDefaultPiwinConfig();
    config.providers = [
      {
        id: 'xai',
        name: 'Grok',
        protocol: 'openai-compatible',
        baseUrl: 'oauth://xai',
        source: 'subscription',
        // The user turned native search off on this one; a re-sync must not undo it.
        models: [{ id: 'grok-4.6', label: 'Grok 4.6', capabilities: ['chat'] }],
      },
    ];
    const next = ensureSubscriptionProviders(
      config,
      [
        { providerId: 'xai', surface: 'v1', state: 'logged-in' },
        { providerId: 'openai-codex', surface: 'v1', state: 'logged-in' },
      ],
      (id) =>
        id === 'xai'
          ? [
              { id: 'grok-4.6', name: 'Grok 4.6' },
              { id: 'grok-4.7', name: 'Grok 4.7' },
              { id: 'grok-imagine-image-2.0', name: 'Imagine', capabilities: ['image-generation'] },
            ]
          : [{ id: 'gpt-5.4-codex', name: 'GPT-5.4 Codex' }],
    );
    const xai = next.providers.find((provider) => provider.id === 'xai');
    const byId = new Map(xai?.models.map((model) => [model.id, model]));
    expect(byId.get('grok-4.7')).toMatchObject({
      capabilities: ['chat', 'native-web-search'],
      nativeSearchAdapter: 'xai-web-search-tool',
    });
    expect(byId.get('grok-4.6')?.capabilities).toEqual(['chat']);
    expect(byId.get('grok-imagine-image-2.0')?.capabilities).toEqual(['image-generation']);
    // Codex has no Host-reachable HTTPS surface: never auto-tagged.
    const codex = next.providers.find((provider) => provider.id === 'openai-codex');
    expect(codex?.models[0]?.capabilities).toEqual(['chat']);
  });

  it('drops subscription rows after logout and keeps BYOK channels', () => {
    const config = createDefaultPiwinConfig();
    config.defaultProviderId = 'openai-codex';
    config.defaultModelId = 'gpt-5.4-codex';
    config.providers = [
      {
        id: 'openai-codex',
        name: 'ChatGPT Codex',
        protocol: 'openai-compatible',
        baseUrl: 'oauth://openai-codex',
        source: 'subscription',
        models: [{ id: 'gpt-5.4-codex', label: 'GPT-5.4 Codex' }],
      },
      {
        id: 'xai',
        name: 'Grok',
        protocol: 'openai-compatible',
        baseUrl: 'oauth://xai',
        source: 'subscription',
        models: [{ id: 'grok-4.6', label: 'Grok 4.6' }],
      },
      {
        id: 'custom-openai',
        name: 'Local',
        protocol: 'openai-compatible',
        baseUrl: 'http://127.0.0.1:11434/v1',
        models: [{ id: 'llama' }],
      },
    ];
    const next = ensureSubscriptionProviders(config, [], () => []);
    expect(next.providers.map((provider) => provider.id)).toEqual(['custom-openai']);
    expect(next.defaultProviderId).toBeUndefined();
    expect(next.defaultModelId).toBeUndefined();
  });

  it('drops leftover vision input from generation extras', () => {
    const config = createDefaultPiwinConfig();
    config.providers = [
      {
        id: 'xai',
        name: 'Grok',
        protocol: 'openai-compatible',
        baseUrl: 'oauth://xai',
        source: 'subscription',
        models: [
          {
            id: 'grok-imagine-image',
            label: 'Grok Imagine Image',
            capabilities: ['image-generation'],
            input: ['text', 'image'],
          },
        ],
      },
    ];
    const merged = upsertSubscriptionProvider(config, 'xai', [{ id: 'grok-4.6', name: 'Grok 4.6' }]);
    expect(merged.providers[0]?.models.find((model) => model.id === 'grok-imagine-image')?.input).toBe(
      undefined,
    );
  });

  it('keeps image extras off the chat picker', () => {
    const next = upsertSubscriptionProvider(createDefaultPiwinConfig(), 'openai-codex', [
      { id: 'gpt-5.4', name: 'GPT-5.4', reasoning: true },
    ]);
    expect(projectConfiguredChatModels(next).models.map((model) => model.modelId)).toEqual([
      'gpt-5.4',
    ]);
  });

  it('refreshes subscription thinkingLevels from the catalog', () => {
    const config = createDefaultPiwinConfig();
    config.providers = [
      {
        id: 'xai',
        name: 'Grok',
        protocol: 'openai-compatible',
        baseUrl: 'oauth://xai',
        source: 'subscription',
        models: [
          {
            id: 'grok-4.5',
            label: 'Grok 4.5',
            thinkingLevels: ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'],
          },
        ],
      },
    ];
    const merged = upsertSubscriptionProvider(config, 'xai', [
      { id: 'grok-4.5', name: 'Grok 4.5', thinkingLevels: ['low', 'medium', 'high'] },
    ]);
    expect(merged.providers[0]?.models.find((model) => model.id === 'grok-4.5')?.thinkingLevels).toEqual([
      'low',
      'medium',
      'high',
    ]);
  });

  it('keeps a user-narrowed thinkingLevels subset across catalog refresh', () => {
    const config = createDefaultPiwinConfig();
    config.providers = [
      {
        id: 'xai',
        name: 'Grok',
        protocol: 'openai-compatible',
        baseUrl: 'oauth://xai',
        source: 'subscription',
        models: [
          {
            id: 'grok-4.5',
            label: 'Grok 4.5',
            thinkingLevels: ['low', 'high'],
            thinkingLevel: 'high',
          },
        ],
      },
    ];
    const merged = upsertSubscriptionProvider(config, 'xai', [
      { id: 'grok-4.5', name: 'Grok 4.5', thinkingLevels: ['low', 'medium', 'high'] },
    ]);
    const model = merged.providers[0]?.models.find((entry) => entry.id === 'grok-4.5');
    expect(model?.thinkingLevels).toEqual(['low', 'high']);
    expect(model?.thinkingLevel).toBe('high');
  });

  it('drops a saved thinkingLevel that the catalog no longer supports', () => {
    const config = createDefaultPiwinConfig();
    config.providers = [
      {
        id: 'xai',
        name: 'Grok',
        protocol: 'openai-compatible',
        baseUrl: 'oauth://xai',
        source: 'subscription',
        models: [
          {
            id: 'grok-4.5',
            label: 'Grok 4.5',
            thinkingLevels: ['low', 'xhigh'],
            thinkingLevel: 'xhigh',
          },
        ],
      },
    ];
    const merged = upsertSubscriptionProvider(config, 'xai', [
      { id: 'grok-4.5', name: 'Grok 4.5', thinkingLevels: ['low', 'medium', 'high'] },
    ]);
    const model = merged.providers[0]?.models.find((entry) => entry.id === 'grok-4.5');
    expect(model?.thinkingLevels).toEqual(['low']);
    expect(model?.thinkingLevel).toBeUndefined();
  });
});
