import { describe, expect, it } from 'vitest';
import {
  CLAUDE_EXTRA_USAGE_SETTINGS_URL,
  formatAnthropicExtraUsageError,
  getSubscriptionBillingNotice,
  isAnthropicExtraUsageErrorMessage,
  modelUsesThirdPartyExtraUsage,
  subscriptionUsesThirdPartyExtraUsage,
} from './subscription-billing-notice.js';

describe('subscription billing notice', () => {
  it('marks only Claude OAuth as third-party extra usage', () => {
    expect(subscriptionUsesThirdPartyExtraUsage('anthropic')).toBe(true);
    expect(subscriptionUsesThirdPartyExtraUsage('openai-codex')).toBe(false);
    expect(subscriptionUsesThirdPartyExtraUsage('anthropic-api')).toBe(false);
    expect(
      modelUsesThirdPartyExtraUsage({ providerId: 'anthropic', source: 'subscription' }),
    ).toBe(true);
    expect(modelUsesThirdPartyExtraUsage({ providerId: 'anthropic', source: 'channel' })).toBe(
      false,
    );
    expect(modelUsesThirdPartyExtraUsage({ providerId: 'anthropic' })).toBe(false);
  });

  it('returns bilingual copy with the official extra-usage URL', () => {
    const zh = getSubscriptionBillingNotice('anthropic', 'zh-CN');
    const en = getSubscriptionBillingNotice('anthropic', 'en');
    expect(zh?.manageUrl).toBe(CLAUDE_EXTRA_USAGE_SETTINGS_URL);
    expect(zh?.body).toContain('extra usage');
    expect(zh?.title).toContain('套餐');
    expect(en?.compact).toMatch(/extra usage/i);
    expect(getSubscriptionBillingNotice('xai', 'zh-CN')).toBeUndefined();
  });

  it('rewrites Anthropic extra-usage 400 prose and ignores other errors', () => {
    const policy =
      'Third-party apps now draw from your extra usage, not your plan limits. Add more at claude.ai/settings/usage and keep going.';
    const exhausted = "You're out of extra usage. Add more at claude.ai/settings/usage and keep going.";
    expect(isAnthropicExtraUsageErrorMessage(policy)).toBe(true);
    expect(isAnthropicExtraUsageErrorMessage(exhausted)).toBe(true);
    expect(isAnthropicExtraUsageErrorMessage('insufficient quota for this workspace')).toBe(false);
    expect(formatAnthropicExtraUsageError(policy, 'en')).toContain(CLAUDE_EXTRA_USAGE_SETTINGS_URL);
    expect(formatAnthropicExtraUsageError(exhausted, 'zh-CN')).toContain('已用完');
  });
});
