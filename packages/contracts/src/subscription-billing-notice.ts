/**
 * Anthropic bills third-party OAuth (Pi / piwin) from extra usage, not
 * Claude Pro/Max plan limits. Official clients keep the included pool.
 * Copy is shared so Desktop, CLI, and Host error rewrite stay aligned.
 */

export const CLAUDE_EXTRA_USAGE_SETTINGS_URL = 'https://claude.ai/settings/usage';

export const THIRD_PARTY_EXTRA_USAGE_PROVIDER_IDS = ['anthropic'] as const;

export type SubscriptionBillingNoticeLocale = 'zh-CN' | 'en';

export type SubscriptionBillingNoticeCopy = {
  kind: 'third-party-extra-usage';
  title: string;
  body: string;
  compact: string;
  afterLogin: string;
  manageUrl: string;
  manageLabel: string;
  planWindowsCaption: string;
  extraUsageLabel: string;
  extraUsageOffHint: string;
  errorPolicy: string;
  errorExhausted: string;
};

export function subscriptionUsesThirdPartyExtraUsage(providerId: string): boolean {
  return (THIRD_PARTY_EXTRA_USAGE_PROVIDER_IDS as readonly string[]).includes(providerId);
}

export function modelUsesThirdPartyExtraUsage(model: {
  providerId: string;
  source?: string;
}): boolean {
  return model.source === 'subscription' && subscriptionUsesThirdPartyExtraUsage(model.providerId);
}

export function getSubscriptionBillingNotice(
  providerId: string,
  locale: SubscriptionBillingNoticeLocale,
): SubscriptionBillingNoticeCopy | undefined {
  if (!subscriptionUsesThirdPartyExtraUsage(providerId)) {
    return undefined;
  }
  return locale === 'zh-CN' ? ZH_ANTHROPIC_NOTICE : EN_ANTHROPIC_NOTICE;
}

const EXTRA_USAGE_ERROR =
  /extra usage/i;
const EXTRA_USAGE_POLICY =
  /third-party|plan limits|claude\.ai\/settings\/usage/i;
const EXTRA_USAGE_EXHAUSTED = /out of extra usage/i;

export function isAnthropicExtraUsageErrorMessage(message: string): boolean {
  if (!EXTRA_USAGE_ERROR.test(message)) {
    return false;
  }
  return EXTRA_USAGE_POLICY.test(message) || EXTRA_USAGE_EXHAUSTED.test(message);
}

export function formatAnthropicExtraUsageError(
  message: string,
  locale: SubscriptionBillingNoticeLocale,
): string | undefined {
  if (!isAnthropicExtraUsageErrorMessage(message)) {
    return undefined;
  }
  const copy = getSubscriptionBillingNotice('anthropic', locale);
  if (!copy) {
    return undefined;
  }
  return EXTRA_USAGE_EXHAUSTED.test(message) ? copy.errorExhausted : copy.errorPolicy;
}

const ZH_ANTHROPIC_NOTICE: SubscriptionBillingNoticeCopy = {
  kind: 'third-party-extra-usage',
  title: '不走套餐内额度',
  body: 'piwin 是第三方客户端。Claude Pro/Max 的 5 小时 / 周限额只给 Claude.ai、Claude Code 和 Cowork。这里按 extra usage 逐 token 计费；没开 extra 或额度用完会直接失败。',
  compact: '当前 Claude 套餐按 extra usage 计费，不走套餐限额。',
  afterLogin: `Claude 已登录。本客户端按 extra usage 计费，不走套餐限额。管理：${CLAUDE_EXTRA_USAGE_SETTINGS_URL}`,
  manageUrl: CLAUDE_EXTRA_USAGE_SETTINGS_URL,
  manageLabel: '管理 extra usage',
  planWindowsCaption: '上面的 5 小时 / 周限额是官方客户端用的，本客户端不扣这些。',
  extraUsageLabel: 'Extra usage（本客户端实际扣费）',
  extraUsageOffHint: '未启用 extra 时，在此发请求会失败。到 claude.ai/settings/usage 开启。',
  errorPolicy: `第三方客户端按 extra usage 计费，不走套餐限额。请到 ${CLAUDE_EXTRA_USAGE_SETTINGS_URL} 开启或增加额度。`,
  errorExhausted: `Extra usage 已用完。到 ${CLAUDE_EXTRA_USAGE_SETTINGS_URL} 加额度后再试。本客户端不走套餐内限额。`,
};

const EN_ANTHROPIC_NOTICE: SubscriptionBillingNoticeCopy = {
  kind: 'third-party-extra-usage',
  title: 'Not billed from plan limits',
  body: 'piwin is a third-party client. Claude Pro/Max 5-hour and weekly limits apply only to Claude.ai, Claude Code, and Cowork. Usage here is billed per token from extra usage. Requests fail if extra usage is off or exhausted.',
  compact: 'This Claude subscription bills extra usage, not plan limits.',
  afterLogin: `Signed in to Claude. Third-party usage draws from extra usage, not plan limits. Manage: ${CLAUDE_EXTRA_USAGE_SETTINGS_URL}`,
  manageUrl: CLAUDE_EXTRA_USAGE_SETTINGS_URL,
  manageLabel: 'Manage extra usage',
  planWindowsCaption: 'The 5-hour / weekly meters are for official clients. This client does not consume them.',
  extraUsageLabel: 'Extra usage (this client)',
  extraUsageOffHint: 'Requests fail while extra usage is off. Enable it at claude.ai/settings/usage.',
  errorPolicy: `Third-party apps draw from extra usage, not plan limits. Enable or add extra usage at ${CLAUDE_EXTRA_USAGE_SETTINGS_URL}.`,
  errorExhausted: `You are out of extra usage. Add more at ${CLAUDE_EXTRA_USAGE_SETTINGS_URL}. This client does not use plan limits.`,
};
