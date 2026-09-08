import { describe, expect, it } from 'vitest';
import {
  deriveColorTone,
  formatFriendlyTimeAgoOrUntil,
  normalizeCodexUsagePayload,
  normalizeGrokUsagePayload,
  normalizeModelGroupsPayload,
} from './subscription-quota-fetcher.js';

describe('subscription-quota-fetcher', () => {
  it('correctly formats friendly time offsets', () => {
    const now = 1757300000000;
    // 30 min in future
    expect(formatFriendlyTimeAgoOrUntil(now + 1800000, now)).toContain('30分钟后');
    // 2 hours in future
    expect(formatFriendlyTimeAgoOrUntil(now + 7200000, now)).toContain('2小时后');
    // 3 days in future
    expect(formatFriendlyTimeAgoOrUntil(now + 259200000, now)).toContain('3天后');
    // 15 min in past
    expect(formatFriendlyTimeAgoOrUntil(now - 900000, now)).toContain('15分钟前');
  });

  it('calculates color tones appropriately', () => {
    expect(deriveColorTone('used', 20)).toBe('mint');
    expect(deriveColorTone('used', 65)).toBe('amber');
    expect(deriveColorTone('used', 90)).toBe('coral');

    expect(deriveColorTone('remaining', 90)).toBe('mint');
    expect(deriveColorTone('remaining', 35)).toBe('amber');
    expect(deriveColorTone('remaining', 10)).toBe('coral');
  });

  it('normalizes OpenAI Codex Plus usage payload with 5h, weekly, and active resets', () => {
    const now = 1757300000000;
    const raw = {
      plan_type: 'plus',
      rate_limit: {
        primary_window: {
          limit_window_seconds: 18000,
          used_percent: 37,
          reset_at: Math.floor((now + 3600000) / 1000),
        },
        secondary_window: {
          limit_window_seconds: 604800,
          used_percent: 10,
          reset_at: Math.floor((now + 432000000) / 1000),
        },
      },
      additional_limits: [
        {
          name: 'gpt-reserve',
          used_percent: 0,
          reset_at: Math.floor((now + 518400000) / 1000),
        },
      ],
      active_resets: {
        count: 2,
        expirations: [
          { index: 1, expires_at: Math.floor((now + 2160000000) / 1000) },
          { index: 2, expires_at: Math.floor((now + 2246400000) / 1000) },
        ],
      },
      subscription: {
        renewal_at: Math.floor((now - 600000) / 1000),
      },
    };

    const quota = normalizeCodexUsagePayload(raw, 'codex-test@example.com', now);
    expect(quota.providerId).toBe('openai-codex');
    expect(quota.planType).toBe('Plus');
    expect(quota.accountEmailOrId).toBe('codex-test@example.com');
    expect(quota.activeResets?.count).toBe(2);
    expect(quota.activeResets?.canTriggerReset).toBe(true);
    expect(quota.activeResets?.slots).toHaveLength(2);
    expect(quota.groups[0]?.windows).toHaveLength(3);

    const primary = quota.groups[0]?.windows[0];
    expect(primary?.label).toBe('5 小时限额');
    expect(primary?.percentage).toBe(37);
    expect(primary?.type).toBe('used');

    const secondary = quota.groups[0]?.windows[1];
    expect(secondary?.label).toBe('周限额');
    expect(secondary?.percentage).toBe(90);
    expect(secondary?.type).toBe('remaining');
  });

  it('normalizes Grok capability breakdown and PAYG state', () => {
    const now = 1757300000000;
    const raw = {
      plan_type: 'Premium',
      weekly_limit: {
        used_percent: 21,
        reset_at: new Date(now + 432000000).toISOString(),
      },
      sub_limits: [
        { label: 'GrokBuild 使用', used_percent: 21 },
        { label: 'GrokImagine 使用', used_percent: null },
        { label: 'GrokTasks 使用', used_percent: null },
      ],
      payg: {
        enabled: false,
        monthly_used_usd: '0.00',
        monthly_limit_usd: '0.00',
        reset_at: new Date(now + 1900800000).toISOString(),
      },
    };

    const quota = normalizeGrokUsagePayload(raw, 'xai-test@qq.com', now);
    expect(quota.providerId).toBe('xai');
    expect(quota.planType).toBe('Premium');
    expect(quota.accountEmailOrId).toBe('xai-test@qq.com');
    expect(quota.payg?.enabled).toBe(false);
    expect(quota.groups[0]?.windows).toHaveLength(4);
    expect(quota.groups[0]?.windows[0]?.label).toBe('周限额');
    expect(quota.groups[0]?.windows[0]?.percentage).toBe(21);
    expect(quota.groups[0]?.windows[1]?.label).toBe('GrokBuild 使用');
    expect(quota.groups[0]?.windows[2]?.label).toBe('GrokImagine 使用');
    expect(quota.groups[0]?.windows[2]?.type).toBe('disabled');
  });

  it('normalizes multi-model group structures', () => {
    const raw = {
      plan_type: 'Pro',
      groups: [
        {
          title: 'GEMINI 模型',
          description: '包含: Gemini Flash, Gemini Pro',
          windows: [
            { label: '5小时限额', remaining_percent: 92, reset_desc: '28 分钟后刷新' },
            { label: '周限额', remaining_percent: 46, reset_desc: '3 天 19 小时后刷新' },
          ],
        },
      ],
    };

    const quota = normalizeModelGroupsPayload('gemini', raw, 'user@gmail.com');
    expect(quota.providerId).toBe('gemini');
    expect(quota.planType).toBe('Pro');
    expect(quota.groups).toHaveLength(1);
    expect(quota.groups[0]?.title).toBe('GEMINI 模型');
    expect(quota.groups[0]?.windows).toHaveLength(2);
    expect(quota.groups[0]?.windows[0]?.percentage).toBe(92);
  });
});
