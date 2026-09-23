import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  deriveColorTone,
  fetchSubscriptionQuota,
  formatFriendlyTimeAgoOrUntil,
  normalizeClaudeUsagePayload,
  normalizeCodexUsagePayload,
  normalizeCopilotUsagePayload,
  normalizeGrokUsagePayload,
  normalizeKimiUsagePayload,
  resetSubscriptionQuota,
} from './subscription-quota-fetcher.js';

const NOW = 1_757_300_000_000;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function writeAuth(contents: Record<string, unknown>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'piwin-quota-'));
  const authPath = join(dir, 'auth.json');
  await writeFile(authPath, JSON.stringify(contents), 'utf8');
  return authPath;
}

const CODEX_USAGE = {
  user_id: 'user-test',
  account_id: 'acct-1',
  email: 'codex-test@example.com',
  plan_type: 'plus',
  rate_limit: {
    allowed: true,
    limit_reached: false,
    primary_window: {
      used_percent: 2,
      limit_window_seconds: 18000,
      reset_after_seconds: 17683,
      reset_at: Math.floor((NOW + 3_600_000) / 1000),
    },
    secondary_window: {
      used_percent: 37,
      limit_window_seconds: 604800,
      reset_after_seconds: 516541,
      reset_at: Math.floor((NOW + 432_000_000) / 1000),
    },
  },
  additional_rate_limits: [
    {
      limit_name: 'gpt-reserve',
      metered_feature: 'base_model_inference',
      rate_limit: {
        allowed: true,
        limit_reached: false,
        primary_window: {
          used_percent: 24,
          limit_window_seconds: 604800,
          reset_at: Math.floor((NOW + 518_400_000) / 1000),
        },
        secondary_window: null,
      },
      normal_model_slug: 'gpt-5.6-luna',
    },
  ],
  credits: { has_credits: false, balance: '0' },
  rate_limit_reset_credits: { available_count: 2, applicable_available_count: 0 },
};

const CODEX_CREDITS = {
  credits: [
    {
      id: 'RateLimitResetCredit_1',
      status: 'available',
      expires_at: '2026-10-04T01:10:09.056600Z',
      title: 'Full reset (Weekly + 5 hr)',
    },
    {
      id: 'RateLimitResetCredit_2',
      status: 'available',
      expires_at: '2026-10-04T22:53:33.248188Z',
      title: 'Full reset (Weekly + 5 hr)',
    },
  ],
  available_count: 2,
};

const GROK_BILLING = {
  config: {
    currentPeriod: {
      type: 'USAGE_PERIOD_TYPE_WEEKLY',
      start: '2026-09-06T13:40:38.104516+00:00',
      end: '2026-09-13T13:40:38.104516+00:00',
    },
    creditUsagePercent: 33,
    onDemandCap: { val: 0 },
    onDemandUsed: { val: 0 },
    productUsage: [
      { product: 'GrokBuild', usagePercent: 33 },
      { product: 'GrokImagine' },
      { product: 'GrokTasks' },
    ],
    isUnifiedBillingUser: true,
    prepaidBalance: { val: 0 },
  },
};

describe('subscription-quota-fetcher helpers', () => {
  it('formats friendly time offsets', () => {
    expect(formatFriendlyTimeAgoOrUntil(NOW + 1_800_000, NOW)).toContain('30分钟后');
    expect(formatFriendlyTimeAgoOrUntil(NOW + 7_200_000, NOW)).toContain('2小时后');
    expect(formatFriendlyTimeAgoOrUntil(NOW + 259_200_000, NOW)).toContain('3天后');
    expect(formatFriendlyTimeAgoOrUntil(NOW - 900_000, NOW)).toContain('15分钟前');
  });

  it('calculates color tones from used and remaining percentages', () => {
    expect(deriveColorTone('used', 20)).toBe('mint');
    expect(deriveColorTone('used', 65)).toBe('amber');
    expect(deriveColorTone('used', 90)).toBe('coral');
    expect(deriveColorTone('remaining', 90)).toBe('mint');
    expect(deriveColorTone('remaining', 35)).toBe('amber');
    expect(deriveColorTone('remaining', 10)).toBe('coral');
  });
});

describe('vendor payload normalizers', () => {
  it('maps Codex wham/usage 5h + weekly + additional_rate_limits + reset credits', () => {
    const quota = normalizeCodexUsagePayload(CODEX_USAGE, 'codex-test@example.com', NOW, CODEX_CREDITS);
    expect(quota.providerId).toBe('openai-codex');
    expect(quota.planType).toBe('Plus');
    expect(quota.activeResets?.count).toBe(2);
    expect(quota.activeResets?.canTriggerReset).toBe(true);
    expect(quota.activeResets?.slots).toHaveLength(2);

    const windows = quota.groups[0]?.windows ?? [];
    expect(windows[0]?.label).toBe('5 小时限额');
    expect(windows[0]?.percentage).toBe(2);
    expect(windows[0]?.type).toBe('used');
    expect(windows[1]?.label).toBe('周限额');
    expect(windows[1]?.percentage).toBe(63);
    expect(windows[1]?.type).toBe('remaining');
    expect(windows[2]?.label).toBe('gpt-reserve 周限额');
    expect(windows[2]?.percentage).toBe(76);
  });

  it('maps SuperGrok billing config + productUsage + settings tier', () => {
    const quota = normalizeGrokUsagePayload(
      GROK_BILLING,
      'xai-test@example.com',
      NOW,
      { subscription_tier_display: 'SuperGrok Heavy' },
    );
    expect(quota.planType).toBe('SuperGrok Heavy');
    expect(quota.payg?.enabled).toBe(false);
    const windows = quota.groups[0]?.windows ?? [];
    expect(windows[0]?.label).toBe('周限额');
    expect(windows[0]?.percentage).toBe(33);
    expect(windows[1]?.label).toBe('Grok Build');
    expect(windows[1]?.percentage).toBe(33);
    expect(windows[2]?.label).toBe('Grok Imagine');
    expect(windows[2]?.type).toBe('disabled');
    expect(windows[3]?.label).toBe('Grok Tasks');
  });

  it('maps Claude oauth/usage 5h + weekly + extra usage', () => {
    const quota = normalizeClaudeUsagePayload(
      {
        five_hour: { utilization: 15, resets_at: '2026-09-09T22:00:00+00:00' },
        seven_day: { utilization: 34, resets_at: '2026-09-15T10:00:00+00:00' },
        seven_day_sonnet: { utilization: 12, resets_at: '2026-09-14T10:00:00+00:00' },
        extra_usage: { is_enabled: true, monthly_limit: 1000, used_credits: 12.5 },
      },
      'claude@example.com',
      NOW,
    );
    expect(quota.providerId).toBe('anthropic');
    expect(quota.groups[0]?.windows[0]?.label).toBe('5 小时限额');
    expect(quota.groups[0]?.windows[0]?.percentage).toBe(15);
    expect(quota.groups[0]?.windows[1]?.label).toBe('周限额');
    expect(quota.groups[0]?.windows[1]?.percentage).toBe(66);
    expect(quota.payg?.enabled).toBe(true);
    expect(quota.payg?.usedText).toContain('12.50');
  });

  it('keeps Claude extra usage visible when the vendor reports it disabled', () => {
    const quota = normalizeClaudeUsagePayload(
      {
        five_hour: { utilization: 2, resets_at: '2026-09-09T22:00:00+00:00' },
        extra_usage: { is_enabled: false, monthly_limit: 0, used_credits: 0 },
      },
      'claude@example.com',
      NOW,
    );
    expect(quota.payg).toEqual({
      enabled: false,
      usedText: 'US$0.00 / US$0.00',
    });
  });

  it('maps Copilot quota_snapshots remaining percents', () => {
    const quota = normalizeCopilotUsagePayload(
      {
        copilot_plan: 'individual',
        quota_reset_date: '2026-10-01T00:00:00Z',
        quota_snapshots: {
          premium_interactions: { entitlement: 50, percent_remaining: 80, unlimited: false },
          completions: { unlimited: true },
        },
      },
      'octocat',
      NOW,
    );
    expect(quota.planType).toBe('Individual');
    expect(quota.groups[0]?.windows[0]?.label).toBe('Premium 请求');
    expect(quota.groups[0]?.windows[0]?.percentage).toBe(80);
    expect(quota.groups[0]?.windows[1]?.valueText).toBe('不限量');
  });

  it('maps Kimi usages weekly counts and 5h window strings', () => {
    const quota = normalizeKimiUsagePayload(
      {
        usage: { limit: '2048', used: '214', remaining: '1834', resetTime: '2026-09-13T15:23:13Z' },
        limits: [
          {
            window: { duration: 300, timeUnit: 'TIME_UNIT_MINUTE' },
            detail: { limit: '200', used: '40', remaining: '160', resetTime: '2026-09-09T13:33:02Z' },
          },
        ],
        user: { membership: { level: 'LEVEL_INTERMEDIATE' } },
      },
      undefined,
      NOW,
    );
    expect(quota.planType).toBe('Intermediate');
    expect(quota.groups[0]?.windows[0]?.label).toBe('周限额');
    expect(quota.groups[0]?.windows[0]?.percentage).toBe(89.6);
    expect(quota.groups[0]?.windows[1]?.label).toBe('5 小时限额');
    expect(quota.groups[0]?.windows[1]?.percentage).toBe(80);
  });
});

describe('fetchSubscriptionQuota', () => {
  it('hits Codex usage + reset-credits and does not invent percentages on failure', async () => {
    const authPath = await writeAuth({
      'openai-codex': { type: 'oauth', access: 'codex-token', accountId: 'acct-1', expires: NOW + 60_000 },
    });
    const urls: string[] = [];
    const quota = await fetchSubscriptionQuota({
      authPath,
      providerId: 'openai-codex',
      nowMs: NOW,
      fetchImpl: async (input) => {
        urls.push(String(input));
        if (String(input).includes('rate-limit-reset-credits')) {
          return jsonResponse(CODEX_CREDITS);
        }
        return jsonResponse(CODEX_USAGE);
      },
    });
    expect(urls.some((url) => url.includes('/wham/usage'))).toBe(true);
    expect(urls.some((url) => url.includes('/wham/rate-limit-reset-credits'))).toBe(true);
    expect(quota.error).toBeUndefined();
    expect(quota.groups[0]?.windows[0]?.percentage).toBe(2);
    expect(quota.activeResets?.count).toBe(2);
  });

  it('reads SuperGrok from cli-chat-proxy billing, not api.x.ai/api-key', async () => {
    const authPath = await writeAuth({
      xai: { type: 'oauth', access: 'xai-token', expires: NOW + 60_000 },
    });
    const urls: string[] = [];
    const quota = await fetchSubscriptionQuota({
      authPath,
      providerId: 'xai',
      nowMs: NOW,
      fetchImpl: async (input) => {
        urls.push(String(input));
        if (String(input).includes('/v1/settings')) {
          return jsonResponse({ subscription_tier_display: 'SuperGrok Heavy' });
        }
        return jsonResponse(GROK_BILLING);
      },
    });
    expect(urls.some((url) => url.includes('cli-chat-proxy.grok.com/v1/billing'))).toBe(true);
    expect(urls.some((url) => url.includes('api.x.ai'))).toBe(false);
    expect(quota.planType).toBe('SuperGrok Heavy');
    expect(quota.groups[0]?.windows[0]?.percentage).toBe(33);
  });

  it('refreshes expired credentials before calling the vendor', async () => {
    const authPath = await writeAuth({
      xai: { type: 'oauth', access: 'stale', refresh: 'r', expires: NOW - 10_000 },
    });
    let refreshCount = 0;
    const tokens: string[] = [];
    const quota = await fetchSubscriptionQuota({
      authPath,
      providerId: 'xai',
      nowMs: NOW,
      refreshCredentials: async () => {
        refreshCount += 1;
        await writeFile(
          authPath,
          JSON.stringify({ xai: { type: 'oauth', access: 'fresh', refresh: 'r', expires: NOW + 3_600_000 } }),
          'utf8',
        );
      },
      fetchImpl: async (_input, init) => {
        const header = new Headers(init?.headers);
        tokens.push(header.get('Authorization') ?? '');
        return jsonResponse(GROK_BILLING);
      },
    });
    expect(refreshCount).toBe(1);
    expect(tokens[0]).toBe('Bearer fresh');
    expect(quota.groups[0]?.windows[0]?.percentage).toBe(33);
  });

  it('retries once after 401 when the stored token is still unexpired', async () => {
    const authPath = await writeAuth({
      xai: { type: 'oauth', access: 'stale', refresh: 'r', expires: NOW + 3_600_000 },
    });
    let refreshCount = 0;
    let billingCalls = 0;
    const quota = await fetchSubscriptionQuota({
      authPath,
      providerId: 'xai',
      nowMs: NOW,
      refreshCredentials: async () => {
        refreshCount += 1;
        await writeFile(
          authPath,
          JSON.stringify({ xai: { type: 'oauth', access: 'fresh', refresh: 'r', expires: NOW + 7_200_000 } }),
          'utf8',
        );
      },
      fetchImpl: async (input) => {
        if (String(input).includes('/v1/billing')) {
          billingCalls += 1;
          if (billingCalls === 1) {
            return jsonResponse({ error: 'unauthenticated' }, 401);
          }
          return jsonResponse(GROK_BILLING);
        }
        return jsonResponse({ subscription_tier_display: 'SuperGrok Heavy' });
      },
    });
    expect(refreshCount).toBe(1);
    expect(billingCalls).toBe(2);
    expect(quota.error).toBeUndefined();
    expect(quota.groups[0]?.windows[0]?.percentage).toBe(33);
  });

  it('returns quota.error instead of synthetic used_percent when the vendor fails', async () => {
    const authPath = await writeAuth({
      'openai-codex': { type: 'oauth', access: 'token', expires: NOW + 60_000 },
    });
    const quota = await fetchSubscriptionQuota({
      authPath,
      providerId: 'openai-codex',
      nowMs: NOW,
      fetchImpl: async () => jsonResponse({ detail: 'Not Found' }, 404),
    });
    expect(quota.error).toMatch(/404|不存在/);
    expect(quota.groups[0]?.windows ?? []).toHaveLength(0);
    expect(quota.groups.every((group) => group.windows.every((win) => win.percentage !== 37))).toBe(true);
  });

  it('consumes Codex reset credits at the live consume endpoint', async () => {
    const authPath = await writeAuth({
      'openai-codex': { type: 'oauth', access: 'token', accountId: 'acct-1', expires: NOW + 60_000 },
    });
    const urls: string[] = [];
    const result = await resetSubscriptionQuota({
      authPath,
      providerId: 'openai-codex',
      fetchImpl: async (input, init) => {
        urls.push(`${init?.method ?? 'GET'} ${String(input)}`);
        if (String(input).includes('/consume')) {
          return jsonResponse({ code: 'reset_completed' });
        }
        if (String(input).includes('rate-limit-reset-credits')) {
          return jsonResponse({ ...CODEX_CREDITS, available_count: 1 });
        }
        return jsonResponse({
          ...CODEX_USAGE,
          rate_limit: {
            ...CODEX_USAGE.rate_limit,
            primary_window: { ...CODEX_USAGE.rate_limit.primary_window, used_percent: 0 },
          },
        });
      },
    });
    expect(urls.some((url) => url.startsWith('POST ') && url.includes('/consume'))).toBe(true);
    expect(urls.some((url) => url.includes('/wham/usage/reset'))).toBe(false);
    expect(result.ok).toBe(true);
    expect(result.quota?.groups[0]?.windows[0]?.percentage).toBe(0);
  });

  it('maps Devin GetUserStatus remaining percents from auth.json oauth', async () => {
    const authPath = await writeAuth({
      devin: { type: 'oauth', access: 'devin-session-token$x' },
    });
    const quota = await fetchSubscriptionQuota({
      authPath,
      providerId: 'devin',
      nowMs: NOW,
      fetchImpl: async (input, init) => {
        expect(String(input)).toContain('SeatManagementService/GetUserStatus');
        expect(init?.method).toBe('POST');
        return jsonResponse({
          userStatus: {
            planStatus: {
              dailyQuotaRemainingPercent: 75,
              weeklyQuotaRemainingPercent: 50,
              overageBalanceMicros: 2500000,
            },
          },
          planInfo: { planName: 'Pro' },
        });
      },
    });
    expect(quota.error).toBeUndefined();
    expect(quota.planType).toBe('Pro');
    expect(quota.groups[0]?.windows[0]?.label).toBe('每日额度');
    expect(quota.groups[0]?.windows[0]?.type).toBe('remaining');
    expect(quota.groups[0]?.windows[0]?.percentage).toBe(75);
    expect(quota.groups[0]?.windows[1]?.label).toBe('每周额度');
    expect(quota.groups[0]?.windows[1]?.percentage).toBe(50);
    expect(quota.payg?.usedText).toBe('$2.50');
  });
});
