import { describe, expect, it } from 'vitest';
import {
  resolveSubscriptionMediaUrl,
  subscriptionMediaBaseUrl,
  subscriptionMediaHeaders,
} from './subscription-media-request.js';

describe('subscription media request', () => {
  it('maps Codex images onto the Codex backend, not oauth://', () => {
    expect(subscriptionMediaBaseUrl('openai-codex', 'image')).toBe(
      'https://chatgpt.com/backend-api',
    );
    expect(
      resolveSubscriptionMediaUrl('openai-codex', 'image', '/codex/images/generations'),
    ).toBe('https://chatgpt.com/backend-api/codex/images/generations');
    expect(subscriptionMediaBaseUrl('openai-codex', 'video')).toBeUndefined();
  });

  it('maps Grok Imagine onto api.x.ai', () => {
    expect(resolveSubscriptionMediaUrl('xai', 'image', '/images/generations')).toBe(
      'https://api.x.ai/v1/images/generations',
    );
    expect(resolveSubscriptionMediaUrl('xai', 'video', '/videos/generations')).toBe(
      'https://api.x.ai/v1/videos/generations',
    );
  });

  it('sends Codex and Grok subscription headers', () => {
    expect(
      subscriptionMediaHeaders('openai-codex', {
        accessToken: 'tok',
        accountId: 'acct-1',
      }),
    ).toEqual({
      authorization: 'Bearer tok',
      'OpenAI-Beta': 'codex-1',
      'User-Agent': 'piwin-host/1.0',
      'ChatGPT-Account-Id': 'acct-1',
    });
    expect(subscriptionMediaHeaders('xai', { accessToken: 'tok' })).toEqual({
      authorization: 'Bearer tok',
      'X-XAI-Token-Auth': 'xai-grok-cli',
    });
  });
});
