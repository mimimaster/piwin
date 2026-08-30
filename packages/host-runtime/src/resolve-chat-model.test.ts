import { describe, expect, it } from 'vitest';
import type { ModelProviderConfig, SubscriptionAccount } from '@piwin/contracts';
import { resolveChatModel } from './resolve-chat-model.js';

const channel: ModelProviderConfig = {
  id: 'custom-openai',
  protocol: 'openai-compatible',
  name: 'CPA',
  baseUrl: 'http://127.0.0.1:8317/v1',
  models: [{ id: 'grok-4.6' }],
};

const loggedIn: SubscriptionAccount = {
  providerId: 'xai',
  surface: 'v1',
  state: 'logged-in',
};

describe('resolveChatModel', () => {
  it('keeps the same model name on a channel and a subscription as two refs', () => {
    const channelHit = resolveChatModel(
      { providers: [channel] },
      { providerId: 'custom-openai', modelId: 'grok-4.6', source: 'channel' },
      { accounts: [loggedIn] },
    );
    const accountHit = resolveChatModel(
      { providers: [channel] },
      { providerId: 'xai', modelId: 'grok-4.6', source: 'subscription' },
      { accounts: [loggedIn], catalogModelIds: new Map([['xai', ['grok-4.6']]]) },
    );
    expect(channelHit?.source).toBe('channel');
    expect(accountHit?.source).toBe('subscription');
  });

  it('resolves Anthropic subscription when the account is logged in', () => {
    const hit = resolveChatModel(
      { providers: [] },
      { providerId: 'anthropic', modelId: 'claude-sonnet-4', source: 'subscription' },
      {
        accounts: [{ providerId: 'anthropic', surface: 'v1', state: 'logged-in' }],
        catalogModelIds: new Map([['anthropic', ['claude-sonnet-4']]]),
      },
    );
    expect(hit?.source).toBe('subscription');
    expect(hit?.ref.providerId).toBe('anthropic');
  });

  it('legacy omitted source prefers an enabled channel with that id', () => {
    const xaiChannel: ModelProviderConfig = {
      id: 'xai',
      protocol: 'openai-compatible',
      name: 'xAI key',
      baseUrl: 'https://api.x.ai/v1',
      models: [{ id: 'grok-4.6' }],
    };
    const hit = resolveChatModel(
      { providers: [xaiChannel] },
      { providerId: 'xai', modelId: 'grok-4.6' },
      { accounts: [loggedIn] },
    );
    expect(hit?.source).toBe('channel');
  });

  it('resolves against a seeded subscription provider without treating it as a channel', () => {
    const seeded: ModelProviderConfig = {
      id: 'openai-codex',
      name: 'ChatGPT Codex',
      protocol: 'openai-compatible',
      baseUrl: 'oauth://openai-codex',
      source: 'subscription',
      models: [{ id: 'gpt-5.4-codex', enabled: true }],
    };
    const hit = resolveChatModel(
      { providers: [seeded] },
      { providerId: 'openai-codex', modelId: 'gpt-5.4-codex', source: 'subscription' },
      { accounts: [{ providerId: 'openai-codex', surface: 'v1', state: 'logged-in' }] },
    );
    expect(hit?.source).toBe('subscription');
    expect(hit?.ref.protocol).toBeUndefined();
  });

  it('does not list subscription models while colliding or needs-reauth', () => {
    expect(
      resolveChatModel(
        { providers: [channel] },
        { providerId: 'xai', modelId: 'grok-4.6', source: 'subscription' },
        { accounts: [{ ...loggedIn, collidingChannelId: 'xai' }] },
      ),
    ).toBeUndefined();
    expect(
      resolveChatModel(
        { providers: [channel] },
        { providerId: 'xai', modelId: 'grok-4.6', source: 'subscription' },
        { accounts: [{ ...loggedIn, state: 'needs-reauth' }] },
      ),
    ).toBeUndefined();
  });
});
