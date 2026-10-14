import { describe, expect, it } from 'vitest';
import {
  nativeSearchProviderBlocker,
  providerUsesSubscriptionChat,
  subscriptionChatBaseUrl,
} from './subscription-chat-surface.js';

describe('subscription chat surface', () => {
  it('only Grok has a Host-reachable surface', () => {
    expect(subscriptionChatBaseUrl('xai')).toBe('https://api.x.ai/v1');
    expect(subscriptionChatBaseUrl('openai-codex')).toBeUndefined();
    expect(providerUsesSubscriptionChat({ id: 'xai', source: 'subscription' })).toBe(true);
  });

  it('blocks native search for unreachable subscriptions and never for channels', () => {
    expect(nativeSearchProviderBlocker({ id: 'kiro', source: 'subscription' })).toMatch(/kiro has no Host-reachable/);
    expect(nativeSearchProviderBlocker({ id: 'openai-codex', source: 'subscription' })).toBeDefined();
    expect(nativeSearchProviderBlocker({ id: 'xai', source: 'subscription' })).toBeUndefined();
    expect(nativeSearchProviderBlocker({ id: 'custom-openai' })).toBeUndefined();
  });

  it('blocks native search on Bedrock only; Vertex grounds through Google Search', () => {
    expect(nativeSearchProviderBlocker({ id: 'bedrock', protocol: 'amazon-bedrock' })).toMatch(/no hosted web search/);
    expect(nativeSearchProviderBlocker({ id: 'vertex', protocol: 'google-vertex' })).toBeUndefined();
    expect(nativeSearchProviderBlocker({ id: 'gemini', protocol: 'google-gemini' })).toBeUndefined();
  });
});
