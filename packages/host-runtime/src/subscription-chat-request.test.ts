import { describe, expect, it } from 'vitest';
import {
  providerUsesSubscriptionChat,
  subscriptionChatBaseUrl,
  subscriptionChatHeaders,
} from './subscription-chat-request.js';

describe('subscription chat request', () => {
  it('maps Grok OAuth onto api.x.ai', () => {
    expect(subscriptionChatBaseUrl('xai')).toBe('https://api.x.ai/v1');
    expect(
      providerUsesSubscriptionChat({ id: 'xai', source: 'subscription' }),
    ).toBe(true);
    expect(subscriptionChatHeaders('xai', { accessToken: 'tok' })).toEqual({
      authorization: 'Bearer tok',
      'X-XAI-Token-Auth': 'xai-grok-cli',
    });
  });

  it('does not map Codex chat (no Host fetch surface)', () => {
    expect(subscriptionChatBaseUrl('openai-codex')).toBeUndefined();
    expect(
      providerUsesSubscriptionChat({ id: 'openai-codex', source: 'subscription' }),
    ).toBe(false);
  });
});
