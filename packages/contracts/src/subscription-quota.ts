/**
 * Subscription Account Quota contracts.
 * Normalizes heterogeneous provider rate limit and subscription quota models
 * (Codex 5h/weekly/active resets, Grok capability breakdown, multi-model groups).
 */

export type QuotaWindowType = 'used' | 'remaining' | 'currency' | 'disabled';

export type QuotaColorTone = 'mint' | 'amber' | 'coral' | 'neutral';

export type QuotaWindow = {
  id?: string | undefined;
  label: string;
  type: QuotaWindowType;
  percentage?: number | undefined;
  valueText?: string | undefined;
  resetTimeText?: string | undefined;
  colorTone?: QuotaColorTone | undefined;
  subDetails?: string | undefined;
};

export type QuotaGroup = {
  id?: string | undefined;
  title?: string | undefined;
  description?: string | undefined;
  windows: QuotaWindow[];
};

export type ActiveResetSlot = {
  index: number;
  label: string;
  expiresText: string;
};

export type ActiveResetsInfo = {
  count: number;
  slots: ActiveResetSlot[];
  canTriggerReset?: boolean | undefined;
};

export type PaygQuotaInfo = {
  enabled: boolean;
  usedText: string;
  resetText?: string | undefined;
};

export type SubscriptionAccountQuota = {
  providerId: string;
  accountEmailOrId?: string | undefined;
  planType?: string | undefined;
  renewalInfo?: string | undefined;
  activeResets?: ActiveResetsInfo | undefined;
  groups: QuotaGroup[];
  payg?: PaygQuotaInfo | undefined;
  lastUpdated: string;
  error?: string | undefined;
};

export type AuthQuotaInput = {
  providerId: string;
  forceRefresh?: boolean | undefined;
};

export type AuthQuotaData = {
  quota: SubscriptionAccountQuota;
};

export type AuthResetQuotaInput = {
  providerId: string;
};

export type AuthResetQuotaData = {
  ok: boolean;
  quota?: SubscriptionAccountQuota | undefined;
  message?: string | undefined;
};

export type AuthQuotaCommand =
  | { id?: string | undefined; type: 'auth/quota'; input: AuthQuotaInput }
  | { id?: string | undefined; type: 'auth/reset-quota'; input: AuthResetQuotaInput };

export type AuthQuotaPush =
  | { type: 'auth/quota-updated'; quota: SubscriptionAccountQuota };
