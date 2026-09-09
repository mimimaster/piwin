/**
 * Normalize vendor quota JSON into SubscriptionAccountQuota.
 * Shapes are taken from live Codex/Grok responses and community-confirmed
 * Claude / Copilot / Kimi payloads — not invented dashboard fixtures.
 */

import type {
  ActiveResetSlot,
  PaygQuotaInfo,
  QuotaGroup,
  QuotaWindow,
  SubscriptionAccountQuota,
} from '@piwin/contracts';
import {
  asArray,
  asFiniteNumber,
  asRecord,
  asString,
  clampPercent,
  deriveColorTone,
  formatFriendlyTimeAgoOrUntil,
  labelForWindowSeconds,
  titleCasePlan,
} from './subscription-quota-shared.js';

function usedWindow(input: {
  id?: string;
  label: string;
  usedPercent: number;
  resetAt?: string | number;
  nowMs: number;
  remainingStyle?: boolean;
  subDetails?: string;
}): QuotaWindow {
  const usedPercent = clampPercent(input.usedPercent);
  const remaining = clampPercent(100 - usedPercent);
  const type = input.remainingStyle ? 'remaining' : 'used';
  const percentage = input.remainingStyle ? remaining : usedPercent;
  const resetTimeText = input.resetAt !== undefined ? formatFriendlyTimeAgoOrUntil(input.resetAt, input.nowMs) : undefined;
  return {
    ...(input.id ? { id: input.id } : {}),
    label: input.label,
    type,
    percentage,
    valueText: input.remainingStyle ? `剩余 ${remaining}%` : `已用 ${usedPercent}%`,
    ...(resetTimeText
      ? { resetTimeText: input.remainingStyle ? `重置 ${resetTimeText}` : resetTimeText }
      : {}),
    colorTone: deriveColorTone(type, percentage),
    ...(input.subDetails ? { subDetails: input.subDetails } : {}),
  };
}

function disabledWindow(label: string): QuotaWindow {
  return {
    label,
    type: 'disabled',
    valueText: '已用 --',
    colorTone: 'neutral',
  };
}

function windowFromVendorLimit(
  raw: Record<string, unknown> | undefined,
  options: { id?: string; fallbackLabel: string; nowMs: number; remainingStyle?: boolean; subDetails?: string },
): QuotaWindow | undefined {
  if (!raw) {
    return undefined;
  }
  const usedPercent = asFiniteNumber(raw.used_percent) ?? asFiniteNumber(raw.utilization);
  if (usedPercent === undefined) {
    return undefined;
  }
  const seconds = asFiniteNumber(raw.limit_window_seconds);
  const resetAt = (raw.reset_at ?? raw.resets_at ?? raw.resetAt) as string | number | undefined;
  return usedWindow({
    ...(options.id ? { id: options.id } : {}),
    label: labelForWindowSeconds(seconds, options.fallbackLabel),
    usedPercent,
    ...(resetAt !== undefined ? { resetAt } : {}),
    nowMs: options.nowMs,
    ...(options.remainingStyle ? { remainingStyle: true } : {}),
    ...(options.subDetails ? { subDetails: options.subDetails } : {}),
  });
}

function emptyQuota(
  providerId: string,
  nowMs: number,
  extra?: Partial<SubscriptionAccountQuota>,
): SubscriptionAccountQuota {
  return {
    providerId,
    groups: extra?.groups ?? [],
    lastUpdated: new Date(nowMs).toISOString(),
    ...extra,
  };
}

/** OpenAI Codex: GET chatgpt.com/backend-api/wham/usage (+ optional reset-credits). */
export function normalizeCodexUsagePayload(
  payload: Record<string, unknown>,
  emailOrId?: string,
  nowMs = Date.now(),
  resetCreditsPayload?: Record<string, unknown>,
): SubscriptionAccountQuota {
  const planType = titleCasePlan(asString(payload.plan_type), 'Plus');
  const email = emailOrId ?? asString(payload.email);
  const subscription = asRecord(payload.subscription);
  let renewalInfo: string | undefined;
  if (subscription) {
    const renewalDate = subscription.renewal_at ?? subscription.expires_at;
    if (renewalDate !== undefined && (typeof renewalDate === 'string' || typeof renewalDate === 'number')) {
      renewalInfo = `续期时间 ${formatFriendlyTimeAgoOrUntil(renewalDate, nowMs)}`;
    }
  }

  const windows: QuotaWindow[] = [];
  const rateLimit = asRecord(payload.rate_limit);
  const primary = windowFromVendorLimit(asRecord(rateLimit?.primary_window), {
    id: 'primary',
    fallbackLabel: '5 小时限额',
    nowMs,
  });
  if (primary) windows.push(primary);
  const secondary = windowFromVendorLimit(asRecord(rateLimit?.secondary_window), {
    id: 'secondary',
    fallbackLabel: '周限额',
    nowMs,
    remainingStyle: true,
  });
  if (secondary) windows.push(secondary);

  const codeReview = windowFromVendorLimit(asRecord(asRecord(payload.code_review_rate_limit)?.primary_window) ?? asRecord(payload.code_review_rate_limit), {
    id: 'code-review',
    fallbackLabel: '代码审查限额',
    nowMs,
    remainingStyle: true,
  });
  if (codeReview) windows.push(codeReview);

  const additional = asArray(payload.additional_rate_limits);
  for (const item of additional) {
    const record = asRecord(item);
    if (!record) continue;
    const nested = asRecord(record.rate_limit);
    const name = asString(record.limit_name) ?? asString(record.name) ?? '专属限额';
    const model = asString(record.normal_model_slug);
    const extraPrimary = windowFromVendorLimit(asRecord(nested?.primary_window) ?? record, {
      id: name,
      fallbackLabel: `${name} 限额`,
      nowMs,
      remainingStyle: true,
      ...(model ? { subDetails: model } : {}),
    });
    if (extraPrimary) {
      extraPrimary.label = extraPrimary.label === '周限额' ? `${name} 周限额` : extraPrimary.label;
      windows.push(extraPrimary);
    }
  }

  const credits = asRecord(payload.credits);
  if (credits?.has_credits === true) {
    const balance = asString(credits.balance) ?? String(asFiniteNumber(credits.balance) ?? 0);
    windows.push({
      id: 'credits',
      label: '额外积分',
      type: 'currency',
      valueText: balance,
      colorTone: 'neutral',
    });
  }

  const usageReset = asRecord(payload.rate_limit_reset_credits);
  const details = resetCreditsPayload ?? usageReset;
  const detailCredits = asArray(details?.credits ?? resetCreditsPayload?.credits);
  const slots: ActiveResetSlot[] = [];
  for (const [index, item] of detailCredits.entries()) {
    const record = asRecord(item);
    if (!record) continue;
    const status = asString(record.status) ?? 'available';
    if (status !== 'available') continue;
    const expiresAt = record.expires_at ?? record.expiresAt;
    slots.push({
      index: index + 1,
      label: asString(record.title) ?? `第 ${index + 1} 次`,
      expiresText:
        typeof expiresAt === 'string' || typeof expiresAt === 'number'
          ? formatFriendlyTimeAgoOrUntil(expiresAt, nowMs)
          : '未指定',
    });
  }
  const count =
    asFiniteNumber(details?.available_count) ??
    asFiniteNumber(usageReset?.available_count) ??
    slots.length;
  const activeResets =
    count > 0 || slots.length > 0
      ? {
          count,
          slots,
          canTriggerReset: count > 0,
        }
      : undefined;

  return {
    providerId: 'openai-codex',
    ...(email ? { accountEmailOrId: email } : {}),
    planType,
    ...(renewalInfo ? { renewalInfo } : {}),
    ...(activeResets ? { activeResets } : {}),
    groups: [{ windows }],
    lastUpdated: new Date(nowMs).toISOString(),
  };
}

const GROK_PRODUCT_LABELS: Record<string, string> = {
  GrokBuild: 'Grok Build',
  GrokImagine: 'Grok Imagine',
  GrokTasks: 'Grok Tasks',
  GrokChat: 'Grok Chat',
  Api: 'API',
};

/** SuperGrok: GET cli-chat-proxy.grok.com/v1/billing?format=credits (+ optional /v1/settings). */
export function normalizeGrokUsagePayload(
  payload: Record<string, unknown>,
  emailOrId?: string,
  nowMs = Date.now(),
  settingsPayload?: Record<string, unknown>,
): SubscriptionAccountQuota {
  const config = asRecord(payload.config) ?? payload;
  const windows: QuotaWindow[] = [];
  const period = asRecord(config.currentPeriod) ?? asRecord(config.current_period);
  const weeklyUsed =
    asFiniteNumber(config.creditUsagePercent) ??
    asFiniteNumber(config.credit_usage_percent) ??
    asFiniteNumber(asRecord(config.weekly_limit)?.used_percent);
  const resetAt =
    asString(period?.end) ??
    asString(config.billingPeriodEnd) ??
    (asRecord(config.weekly_limit)?.reset_at as string | number | undefined);

  if (weeklyUsed !== undefined) {
    const periodType = asString(period?.type) ?? '';
    const weeklyLabel = periodType.includes('MONTH') ? '月限额' : '周限额';
    windows.push(
      usedWindow({
        id: 'weekly',
        label: weeklyLabel,
        usedPercent: weeklyUsed,
        ...(resetAt !== undefined ? { resetAt } : {}),
        nowMs,
      }),
    );
  }

  const products = asArray(config.productUsage ?? config.product_usage ?? config.sub_limits);
  for (const product of products) {
    const record = asRecord(product);
    if (!record) continue;
    const rawName = asString(record.product) ?? asString(record.label) ?? '功能使用';
    const label = GROK_PRODUCT_LABELS[rawName] ?? rawName;
    const usedPct = asFiniteNumber(record.usagePercent) ?? asFiniteNumber(record.used_percent);
    if (usedPct === undefined) {
      windows.push(disabledWindow(label));
      continue;
    }
    windows.push(
      usedWindow({
        id: rawName,
        label,
        usedPercent: usedPct,
        nowMs,
      }),
    );
  }

  const capRecord = asRecord(config.onDemandCap) ?? asRecord(config.on_demand_cap);
  const usedRecord = asRecord(config.onDemandUsed) ?? asRecord(config.on_demand_used);
  const cap = asFiniteNumber(capRecord?.val) ?? asFiniteNumber(config.onDemandCap);
  const used = asFiniteNumber(usedRecord?.val) ?? asFiniteNumber(config.onDemandUsed) ?? 0;
  const paygEnabled = cap !== undefined && cap > 0;
  const payg: PaygQuotaInfo = paygEnabled
    ? {
        enabled: true,
        usedText: `US$${used.toFixed(2)} / US$${cap.toFixed(2)}`,
        ...(resetAt ? { resetText: formatFriendlyTimeAgoOrUntil(resetAt, nowMs) } : {}),
      }
    : {
        enabled: false,
        usedText: 'US$0.00 / US$0.00',
        resetText: '未启用',
      };

  const planType =
    asString(settingsPayload?.subscription_tier_display) ??
    asString(config.plan_type) ??
    'SuperGrok';

  return {
    providerId: 'xai',
    ...(emailOrId ? { accountEmailOrId: emailOrId } : {}),
    planType,
    ...(resetAt
      ? { renewalInfo: `重置 ${formatFriendlyTimeAgoOrUntil(resetAt, nowMs)}` }
      : {}),
    groups: [{ windows }],
    payg,
    lastUpdated: new Date(nowMs).toISOString(),
  };
}

function claudeWindow(
  raw: Record<string, unknown> | undefined,
  id: string,
  label: string,
  nowMs: number,
  remainingStyle: boolean,
): QuotaWindow | undefined {
  if (!raw) return undefined;
  const usedPercent = asFiniteNumber(raw.utilization) ?? asFiniteNumber(raw.percent);
  if (usedPercent === undefined) return undefined;
  const resetAt = raw.resets_at ?? raw.reset_at;
  return usedWindow({
    id,
    label,
    usedPercent,
    ...(typeof resetAt === 'string' || typeof resetAt === 'number' ? { resetAt } : {}),
    nowMs,
    remainingStyle,
  });
}

/** Claude Pro/Max: GET api.anthropic.com/api/oauth/usage */
export function normalizeClaudeUsagePayload(
  payload: Record<string, unknown>,
  emailOrId?: string,
  nowMs = Date.now(),
): SubscriptionAccountQuota {
  const windows: QuotaWindow[] = [];
  const fiveHour = claudeWindow(asRecord(payload.five_hour), 'five_hour', '5 小时限额', nowMs, false);
  if (fiveHour) windows.push(fiveHour);
  const sevenDay = claudeWindow(asRecord(payload.seven_day), 'seven_day', '周限额', nowMs, true);
  if (sevenDay) windows.push(sevenDay);
  const sonnet = claudeWindow(asRecord(payload.seven_day_sonnet), 'seven_day_sonnet', 'Sonnet 周限额', nowMs, true);
  if (sonnet) windows.push(sonnet);
  const opus = claudeWindow(asRecord(payload.seven_day_opus), 'seven_day_opus', 'Opus 周限额', nowMs, true);
  if (opus) windows.push(opus);

  for (const item of asArray(payload.limits)) {
    const record = asRecord(item);
    if (!record || asString(record.kind) !== 'weekly_scoped') continue;
    const modelName = asString(asRecord(asRecord(record.scope)?.model)?.display_name);
    const scoped = claudeWindow(record, modelName ?? 'scoped', modelName ? `${modelName} 周限额` : '模型周限额', nowMs, true);
    if (scoped) windows.push(scoped);
  }

  const extra = asRecord(payload.extra_usage);
  const payg =
    extra && extra.is_enabled === true
      ? {
          enabled: true,
          usedText: `US$${(asFiniteNumber(extra.used_credits) ?? 0).toFixed(2)} / US$${(asFiniteNumber(extra.monthly_limit) ?? 0).toFixed(2)}`,
        }
      : undefined;

  const groups: QuotaGroup[] = [{ windows }];
  return {
    providerId: 'anthropic',
    ...(emailOrId ? { accountEmailOrId: emailOrId } : {}),
    planType: titleCasePlan(asString(payload.plan_type) ?? asString(payload.subscription_type), 'Pro'),
    groups,
    ...(payg ? { payg } : {}),
    lastUpdated: new Date(nowMs).toISOString(),
  };
}

const COPILOT_SNAPSHOT_LABELS: Record<string, string> = {
  premium_interactions: 'Premium 请求',
  premiumInteractions: 'Premium 请求',
  premium_models: 'Premium 模型',
  chat: 'Chat',
  completions: '补全',
};

/** GitHub Copilot: GET api.github.com/copilot_internal/user */
export function normalizeCopilotUsagePayload(
  payload: Record<string, unknown>,
  emailOrId?: string,
  nowMs = Date.now(),
): SubscriptionAccountQuota {
  const snapshots =
    asRecord(payload.quota_snapshots) ??
    asRecord(payload.quotaSnapshots) ??
    asRecord(asRecord(payload.copilot)?.quota_snapshots);
  const windows: QuotaWindow[] = [];
  const resetDate = asString(payload.quota_reset_date) ?? asString(payload.quotaResetDate);

  if (snapshots) {
    for (const [key, raw] of Object.entries(snapshots)) {
      const record = asRecord(raw);
      if (!record) continue;
      const label = COPILOT_SNAPSHOT_LABELS[key] ?? key;
      if (record.unlimited === true) {
        windows.push({
          id: key,
          label,
          type: 'remaining',
          percentage: 100,
          valueText: '不限量',
          colorTone: 'mint',
          ...(resetDate ? { resetTimeText: `重置 ${formatFriendlyTimeAgoOrUntil(resetDate, nowMs)}` } : {}),
        });
        continue;
      }
      const remaining =
        asFiniteNumber(record.percent_remaining) ??
        asFiniteNumber(record.percentRemaining) ??
        asFiniteNumber(record.remainingPercentage);
      if (remaining === undefined) continue;
      const usedPercent = clampPercent(100 - remaining);
      windows.push(
        usedWindow({
          id: key,
          label,
          usedPercent,
          ...(resetDate ? { resetAt: resetDate } : {}),
          nowMs,
          remainingStyle: true,
        }),
      );
    }
  }

  const planType =
    titleCasePlan(asString(payload.copilot_plan) ?? asString(payload.sku) ?? asString(payload.plan), 'Copilot');

  return {
    providerId: 'github-copilot',
    ...(emailOrId ? { accountEmailOrId: emailOrId } : {}),
    planType,
    groups: [{ windows }],
    lastUpdated: new Date(nowMs).toISOString(),
  };
}

function kimiCountWindow(
  detail: Record<string, unknown> | undefined,
  id: string,
  label: string,
  nowMs: number,
): QuotaWindow | undefined {
  if (!detail) return undefined;
  const limit = asFiniteNumber(detail.limit);
  const remaining = asFiniteNumber(detail.remaining);
  const used = asFiniteNumber(detail.used);
  if (limit === undefined || limit <= 0) return undefined;
  const usedCount = used ?? (remaining !== undefined ? Math.max(0, limit - remaining) : 0);
  const usedPercent = clampPercent((usedCount / limit) * 100);
  const resetAt = detail.resetTime ?? detail.reset_time ?? detail.reset_at;
  return usedWindow({
    id,
    label,
    usedPercent,
    ...(typeof resetAt === 'string' || typeof resetAt === 'number' ? { resetAt } : {}),
    nowMs,
    remainingStyle: true,
    subDetails: `${usedCount} / ${limit}`,
  });
}

function kimiWindowLabel(raw: Record<string, unknown> | undefined): string {
  const window = asRecord(raw?.window);
  const duration = asFiniteNumber(window?.duration);
  const unit = asString(window?.timeUnit) ?? asString(window?.time_unit);
  if (duration !== undefined && unit?.includes('MINUTE')) {
    return labelForWindowSeconds(duration * 60, '5 小时限额');
  }
  if (duration !== undefined && unit?.includes('HOUR')) {
    return labelForWindowSeconds(duration * 3600, '5 小时限额');
  }
  return labelForWindowSeconds(duration, '速率窗口');
}

/** Kimi Code: GET api.kimi.com/coding/v1/usages */
export function normalizeKimiUsagePayload(
  payload: Record<string, unknown>,
  emailOrId?: string,
  nowMs = Date.now(),
): SubscriptionAccountQuota {
  const windows: QuotaWindow[] = [];
  const weekly = kimiCountWindow(asRecord(payload.usage), 'weekly', '周限额', nowMs);
  if (weekly) windows.push(weekly);

  for (const [index, item] of asArray(payload.limits).entries()) {
    const record = asRecord(item);
    const detail = asRecord(record?.detail) ?? record;
    const label = kimiWindowLabel(record);
    const window = kimiCountWindow(detail, `limit-${index}`, label, nowMs);
    if (window) windows.push(window);
  }

  const membership = asRecord(asRecord(payload.user)?.membership);
  const planType = titleCasePlan(asString(membership?.level) ?? asString(payload.plan_type), 'Kimi Code');

  return {
    providerId: 'kimi-coding',
    ...(emailOrId ? { accountEmailOrId: emailOrId } : {}),
    planType,
    groups: [{ windows }],
    lastUpdated: new Date(nowMs).toISOString(),
  };
}

export function quotaErrorResult(
  providerId: string,
  error: string,
  emailOrId?: string,
  nowMs = Date.now(),
): SubscriptionAccountQuota {
  return emptyQuota(providerId, nowMs, {
    ...(emailOrId ? { accountEmailOrId: emailOrId } : {}),
    error,
  });
}
