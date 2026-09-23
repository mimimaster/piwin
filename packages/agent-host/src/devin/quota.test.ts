import { describe, expect, it } from 'vitest';
import { parseDevinQuota } from './quota.js';

describe('parseDevinQuota', () => {
  it('reads camelCase GetUserStatus fields', () => {
    expect(
      parseDevinQuota({
        userStatus: {
          planStatus: {
            dailyQuotaRemainingPercent: 80,
            weeklyQuotaRemainingPercent: 40,
            dailyQuotaResetAtUnix: 1_700_000_000,
            weeklyQuotaResetAtUnix: 1_700_086_400,
            overageBalanceMicros: 1_250_000,
          },
        },
        planInfo: { planName: 'Pro', hideDailyQuota: false, hideWeeklyQuota: false },
      }),
    ).toEqual({
      plan: 'Pro',
      dailyRemaining: 80,
      weeklyRemaining: 40,
      dailyReset: 1_700_000_000,
      weeklyReset: 1_700_086_400,
      hideDaily: false,
      hideWeekly: false,
      overageMicros: 1_250_000,
    });
  });

  it('reads snake_case GetUserStatus fields', () => {
    expect(
      parseDevinQuota({
        user_status: {
          plan_status: {
            daily_quota_remaining_percent: '12',
            weekly_quota_remaining_percent: '90',
            overage_balance_micros: '0',
          },
        },
        plan_info: { plan_name: 'Core', hide_daily_quota: true, hide_weekly_quota: false },
      }),
    ).toEqual({
      plan: 'Core',
      dailyRemaining: 12,
      weeklyRemaining: 90,
      hideDaily: true,
      hideWeekly: false,
      overageMicros: 0,
    });
  });
});
