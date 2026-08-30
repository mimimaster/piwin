import { describe, expect, it } from 'vitest';
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
    expect(next.providers).toEqual([
      {
        id: 'openai-codex',
        name: 'ChatGPT Codex',
        protocol: 'openai-compatible',
        baseUrl: 'oauth://openai-codex',
        source: 'subscription',
        models: [
          {
            id: 'gpt-5.4-codex',
            label: 'GPT-5.4 Codex',
            capabilities: ['chat'],
            reasoning: true,
          },
        ],
      },
    ]);
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
    expect(merged.providers[0]?.models).toEqual([
      {
        id: 'gpt-5.4-codex',
        label: 'Codex',
        capabilities: ['chat'],
        enabled: false,
        contextWindow: 200_000,
      },
      catalogModelToConfigEntry({ id: 'gpt-5.4', name: 'GPT-5.4' }),
    ]);

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
});
