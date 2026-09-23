import { describe, expect, it } from 'vitest';
import type { HostCommand, HostPush } from './ipc.js';
import {
  allocateRelocateChannelId,
  allocateUniqueProviderId,
  allocateUniqueProviderName,
  isChannelProvider,
  isIgnoredSubscriptionProviderId,
  isSubscriptionProvider,
  isV1SubscriptionProviderId,
  isSubscriptionOauthProviderId,
  isClaudeCodeOauthProviderId,
  piOauthLoginProviderId,
  CLAUDE_CODE_OAUTH_PROVIDER_ID,
} from './subscription-oauth.js';

describe('subscription oauth contracts', () => {
  it('allowlists Pi subscription OAuth, not OpenRouter keys', () => {
    expect(isV1SubscriptionProviderId('kimi-coding')).toBe(true);
    expect(isV1SubscriptionProviderId('openai-codex')).toBe(true);
    expect(isV1SubscriptionProviderId('anthropic')).toBe(true);
    expect(isV1SubscriptionProviderId('xai')).toBe(true);
    expect(isV1SubscriptionProviderId('github-copilot')).toBe(true);
    expect(isV1SubscriptionProviderId('devin')).toBe(true);
    expect(isSubscriptionOauthProviderId('devin')).toBe(true);
    expect(piOauthLoginProviderId('devin')).toBe('devin');
    expect(isV1SubscriptionProviderId('openrouter')).toBe(false);
    expect(isV1SubscriptionProviderId(CLAUDE_CODE_OAUTH_PROVIDER_ID)).toBe(false);
    expect(isSubscriptionOauthProviderId(CLAUDE_CODE_OAUTH_PROVIDER_ID)).toBe(true);
    expect(isClaudeCodeOauthProviderId(CLAUDE_CODE_OAUTH_PROVIDER_ID)).toBe(true);
    expect(piOauthLoginProviderId(CLAUDE_CODE_OAUTH_PROVIDER_ID)).toBe('anthropic');
    expect(piOauthLoginProviderId('anthropic')).toBe('anthropic');
    expect(isV1SubscriptionProviderId('antigravity')).toBe(false);
    expect(isIgnoredSubscriptionProviderId('anthropic')).toBe(false);
    expect(isSubscriptionProvider({ source: 'subscription' })).toBe(true);
    expect(isChannelProvider({ source: 'subscription' })).toBe(false);
    expect(isChannelProvider({})).toBe(true);
  });

  it('accepts auth command and push shapes', () => {
    const status: HostCommand = { type: 'auth/status' };
    const refreshCatalog: HostCommand = { type: 'auth/refresh-catalog' };
    const login: HostCommand = {
      type: 'auth/login',
      input: { providerId: 'openai-codex', ownerDeviceId: 'desktop-1' },
    };
    const prompt: HostPush = {
      type: 'auth/prompt',
      prompt: {
        loginId: 'login-1',
        promptId: 'p1',
        providerId: 'openai-codex',
        kind: 'device_code',
        userCode: 'ABCD-EFGH',
        verificationUri: 'https://example.test',
      },
    };
    const detect: HostCommand = { type: 'pi-environment/detect' };
    const preview: HostCommand = { type: 'pi-environment/preview' };
    const apply: HostCommand = { type: 'pi-environment/apply' };
    const quota: HostCommand = {
      type: 'auth/quota',
      input: { providerId: 'openai-codex', forceRefresh: true },
    };
    const quotaPush: HostPush = {
      type: 'auth/quota-updated',
      quota: {
        providerId: 'openai-codex',
        groups: [],
        lastUpdated: new Date().toISOString(),
      },
    };
    expect(status.type).toBe('auth/status');
    expect(refreshCatalog.type).toBe('auth/refresh-catalog');
    expect(login.type).toBe('auth/login');
    expect(detect.type).toBe('pi-environment/detect');
    expect(preview.type).toBe('pi-environment/preview');
    expect(apply.type).toBe('pi-environment/apply');
    expect(prompt.type).toBe('auth/prompt');
    expect(quota.type).toBe('auth/quota');
    expect(quotaPush.type).toBe('auth/quota-updated');
  });

  it('allocates unique provider ids and relocate ids', () => {
    expect(allocateUniqueProviderId('xai', [])).toBe('xai');
    expect(allocateUniqueProviderId('xai', ['xai'])).toBe('xai-2');
    expect(allocateUniqueProviderId('xai', ['xai', 'xai-2'])).toBe('xai-3');
    expect(allocateRelocateChannelId('xai', ['xai'])).toBe('xai-api');
    expect(allocateRelocateChannelId('xai', ['xai', 'xai-api'])).toBe('xai-api-2');
    expect(allocateUniqueProviderName('xAI', ['xai'])).toBe('xAI 2');
  });
});
