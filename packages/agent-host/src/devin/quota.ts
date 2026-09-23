import { DEVIN_HOST, normalizeSessionToken } from './protocol.js';

const QUOTA_PATH = '/exa.seat_management_pb.SeatManagementService/GetUserStatus';

export type DevinQuota = {
  plan: string;
  dailyRemaining?: number;
  weeklyRemaining?: number;
  dailyReset?: number;
  weeklyReset?: number;
  hideDaily: boolean;
  hideWeekly: boolean;
  overageMicros: number;
};

export async function fetchDevinQuota(
  apiKey: string,
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<DevinQuota> {
  const timeout = AbortSignal.timeout(10_000);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const response = await fetchImpl(`${DEVIN_HOST}${QUOTA_PATH}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'connect-protocol-version': '1' },
    body: JSON.stringify({
      metadata: {
        apiKey: normalizeSessionToken(apiKey),
        ideName: 'devin',
        ideVersion: '1.108.2',
        extensionName: 'devin',
        extensionVersion: '1.108.2',
        locale: 'en',
      },
    }),
    signal: combined,
  });
  if (!response.ok) {
    throw new Error('Devin quota request failed');
  }
  return parseDevinQuota(await response.json());
}

export function parseDevinQuota(payload: unknown): DevinQuota {
  if (!isRecord(payload)) {
    throw new Error('Invalid Devin quota response');
  }
  const userStatus = pick(payload, 'userStatus', 'user_status');
  const planInfo = pick(payload, 'planInfo', 'plan_info');
  const planStatus = pick(userStatus, 'planStatus', 'plan_status');
  const nestedPlan = pick(planStatus, 'planInfo', 'plan_info');
  const plan =
    asTrimmedString(pick(planInfo, 'planName', 'plan_name')) ||
    asTrimmedString(pick(nestedPlan, 'planName', 'plan_name'));
  if (!plan) {
    throw new Error('Invalid Devin quota response');
  }
  const dailyRemaining = percentage(
    pick(planStatus, 'dailyQuotaRemainingPercent', 'daily_quota_remaining_percent'),
  );
  const weeklyRemaining = percentage(
    pick(planStatus, 'weeklyQuotaRemainingPercent', 'weekly_quota_remaining_percent'),
  );
  const dailyReset = integer(pick(planStatus, 'dailyQuotaResetAtUnix', 'daily_quota_reset_at_unix'));
  const weeklyReset = integer(
    pick(planStatus, 'weeklyQuotaResetAtUnix', 'weekly_quota_reset_at_unix'),
  );
  return {
    plan,
    ...(dailyRemaining !== undefined ? { dailyRemaining } : {}),
    ...(weeklyRemaining !== undefined ? { weeklyRemaining } : {}),
    ...(dailyReset !== undefined ? { dailyReset } : {}),
    ...(weeklyReset !== undefined ? { weeklyReset } : {}),
    hideDaily: Boolean(pick(planInfo, 'hideDailyQuota', 'hide_daily_quota')),
    hideWeekly: Boolean(pick(planInfo, 'hideWeeklyQuota', 'hide_weekly_quota')),
    overageMicros: integer(pick(planStatus, 'overageBalanceMicros', 'overage_balance_micros')) ?? 0,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function pick(payload: unknown, camel: string, snake: string): unknown {
  return isRecord(payload) ? (payload[camel] ?? payload[snake]) : undefined;
}

function asTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function integer(value: unknown): number | undefined {
  const result = typeof value === 'string' || typeof value === 'number' ? Number(value) : Number.NaN;
  return Number.isFinite(result) ? result : undefined;
}

function percentage(value: unknown): number | undefined {
  const result = integer(value);
  return result !== undefined && result >= 0 && result <= 100 ? result : undefined;
}
