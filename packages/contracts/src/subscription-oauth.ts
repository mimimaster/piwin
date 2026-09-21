/**
 * Pi-native subscription / vendor OAuth.
 * Accounts live in {PIWIN_ROOT}/pi-agent/auth.json; channels stay in config.providers[].
 * Allowlist is Pi subscription OAuth (isSubscription), not every Pi oauth helper.
 * OpenRouter is a BYOK key channel. Radius is a gateway helper. Antigravity is not in Pi.
 */

export const V1_SUBSCRIPTION_PROVIDER_IDS = [
  'kimi-coding',
  'openai-codex',
  'anthropic',
  'xai',
  'github-copilot',
] as const;

export type V1SubscriptionProviderId = (typeof V1_SUBSCRIPTION_PROVIDER_IDS)[number];

/**
 * Claude Code / pi-anthropic-auth path — plan-quota shaping, independent of
 * the v1 `anthropic` extra-usage card. Own auth.json key + Models provider.
 */
export const CLAUDE_CODE_OAUTH_PROVIDER_ID = 'anthropic-claude-code' as const;
export type ClaudeCodeOauthProviderId = typeof CLAUDE_CODE_OAUTH_PROVIDER_ID;

/** Every Host-managed subscription OAuth id (v1 cards + Claude Code card). */
export const SUBSCRIPTION_OAUTH_PROVIDER_IDS = [
  ...V1_SUBSCRIPTION_PROVIDER_IDS,
  CLAUDE_CODE_OAUTH_PROVIDER_ID,
] as const;

export type SubscriptionOauthProviderId = (typeof SUBSCRIPTION_OAUTH_PROVIDER_IDS)[number];

/** Extra stored oauth we may list in doctor but never put on a card. */
export const IGNORED_SUBSCRIPTION_PROVIDER_IDS: readonly string[] = [];

export type IgnoredSubscriptionProviderId = string;

export const SUBSCRIPTION_DEFAULT_FALLBACK_ORDER = V1_SUBSCRIPTION_PROVIDER_IDS;

export type SubscriptionAccountState =
  | 'logged-out'
  | 'logging-in'
  | 'logged-in'
  | 'needs-reauth'
  | 'sync-error';

export type SubscriptionSurface = 'v1' | 'ignored';

export type ModelSource = 'channel' | 'subscription';

export type ConfiguredChatModelGroup = 'subscription' | 'channel';

export type SubscriptionAccount = {
  providerId: string;
  surface: SubscriptionSurface;
  state: SubscriptionAccountState;
  collidingChannelId?: string;
};

export type AuthPromptKind =
  | 'info'
  | 'progress'
  | 'auth_url'
  | 'device_code'
  | 'select'
  | 'text'
  | 'secret'
  | 'manual_code'
  | 'prompt-cancelled';

export type AuthPromptOption = {
  id: string;
  label: string;
  description?: string;
};

export type AuthPromptLink = {
  url: string;
  label?: string;
};

export type AuthPromptPayload = {
  loginId: string;
  promptId: string;
  providerId: string;
  kind: AuthPromptKind;
  message?: string;
  url?: string;
  instructions?: string;
  links?: readonly AuthPromptLink[];
  userCode?: string;
  verificationUri?: string;
  intervalSeconds?: number;
  expiresInSeconds?: number;
  options?: readonly AuthPromptOption[];
  placeholder?: string;
  expectsResponse?: boolean;
};

/** Sanitized in-flight login for reconnect. Never includes respond values. */
export type ActiveLoginStatus = {
  loginId: string;
  providerId: string;
  ownerDeviceId: string;
  ownerConnected: boolean;
  startedAt: string;
  currentPrompt?: AuthPromptPayload;
  authUrl?: AuthPromptPayload;
};

export type AuthStatusData = {
  accounts: SubscriptionAccount[];
  activeLogin?: ActiveLoginStatus;
};

export type AuthLoginInput = {
  providerId: string;
  ownerDeviceId: string;
  relocateChannelId?: string;
  /** Codex/Claude use the browser + paste-callback flow. Device code is not the default. */
  preferLoopback?: boolean;
  /**
   * Host opens the verification URL in the system browser.
   * Desktop opens the URL itself; pass false so Grok/Codex do not get two tabs.
   * Omit (CLI) to keep Host opening.
   */
  openAuthUrlOnHost?: boolean;
};

export type AuthLoginData = {
  loginId: string;
};

/** Successful `auth/refresh-catalog` payload. Overlay pull failed uses the Host error response. */
export type AuthRefreshCatalogData = {
  modelCount: number;
};


export type AuthRespondInput = {
  loginId: string;
  promptId: string;
  value: string;
  ownerDeviceId?: string;
};

export type AuthClaimInput = {
  loginId: string;
  ownerDeviceId?: string;
};

export type AuthLogoutInput = {
  providerId: string;
};

export type AuthLoginFinishedData = {
  loginId: string;
  providerId: string;
  ok: boolean;
  errorCode?: string;
  newChannelId?: string;
};

export type AuthUpdatedData = {
  accounts: SubscriptionAccount[];
};

import type {
  AuthQuotaInput,
  AuthResetQuotaInput,
  SubscriptionAccountQuota,
} from './subscription-quota.js';

export type SubscriptionAuthCommand =
  | { id?: string; type: 'auth/status' }
  | { id?: string; type: 'auth/login'; input: AuthLoginInput }
  | { id?: string; type: 'auth/respond'; input: AuthRespondInput }
  | { id?: string; type: 'auth/cancel'; loginId: string; ownerDeviceId?: string }
  | { id?: string; type: 'auth/claim'; input: AuthClaimInput }
  | { id?: string; type: 'auth/logout'; input: AuthLogoutInput }
  | { id?: string; type: 'auth/quota'; input: AuthQuotaInput }
  | { id?: string; type: 'auth/reset-quota'; input: AuthResetQuotaInput }
  | { id?: string; type: 'auth/refresh-catalog' };

export type SubscriptionAuthPush =
  | { type: 'auth/prompt'; prompt: AuthPromptPayload }
  | { type: 'auth/updated'; accounts: SubscriptionAccount[] }
  | { type: 'auth/login-finished'; result: AuthLoginFinishedData }
  | { type: 'auth/quota-updated'; quota: SubscriptionAccountQuota };

export const AUTH_PROBLEM_CODES = [
  'unsupported-subscription-provider',
  'auth-busy',
  'auth-not-owner',
  'ticket-consumed',
  'collision',
  'credential-sync-failed',
  'oauth-callback-port-busy',
  'auth-store-unreadable',
  'provider-authentication',
] as const;

export type AuthProblemCode = (typeof AUTH_PROBLEM_CODES)[number];

export const AUTH_LOGIN_IDLE_MS = 15 * 60 * 1000;
export const AUTH_UPDATED_DEBOUNCE_MS = 100;
export const CODEX_OAUTH_CALLBACK_PORT = 1455;

export const V1_SUBSCRIPTION_PROVIDER_META: Record<
  V1SubscriptionProviderId,
  { readonly name: string; readonly oauthOrigin: string }
> = {
  'kimi-coding': { name: 'Kimi Code', oauthOrigin: 'oauth://kimi-coding' },
  'openai-codex': { name: 'ChatGPT Codex', oauthOrigin: 'oauth://openai-codex' },
  anthropic: { name: 'Claude', oauthOrigin: 'oauth://anthropic' },
  xai: { name: 'Grok', oauthOrigin: 'oauth://xai' },
  'github-copilot': { name: 'GitHub Copilot', oauthOrigin: 'oauth://github-copilot' },
};

export const CLAUDE_CODE_OAUTH_PROVIDER_META = {
  name: 'Claude Code',
  oauthOrigin: 'oauth://anthropic-claude-code',
} as const;

export const SUBSCRIPTION_OAUTH_PROVIDER_META: Record<
  SubscriptionOauthProviderId,
  { readonly name: string; readonly oauthOrigin: string }
> = {
  ...V1_SUBSCRIPTION_PROVIDER_META,
  [CLAUDE_CODE_OAUTH_PROVIDER_ID]: CLAUDE_CODE_OAUTH_PROVIDER_META,
};

export function isV1SubscriptionProviderId(providerId: string): providerId is V1SubscriptionProviderId {
  return (V1_SUBSCRIPTION_PROVIDER_IDS as readonly string[]).includes(providerId);
}

export function isClaudeCodeOauthProviderId(
  providerId: string,
): providerId is ClaudeCodeOauthProviderId {
  return providerId === CLAUDE_CODE_OAUTH_PROVIDER_ID;
}

export function isSubscriptionOauthProviderId(
  providerId: string,
): providerId is SubscriptionOauthProviderId {
  return (SUBSCRIPTION_OAUTH_PROVIDER_IDS as readonly string[]).includes(providerId);
}

/** Pi login id used to obtain tokens (Claude Code reuses native anthropic OAuth). */
export function piOauthLoginProviderId(providerId: string): string {
  return isClaudeCodeOauthProviderId(providerId) ? 'anthropic' : providerId;
}

/** Models-page provider seeded from a v1 OAuth account. Not a BYOK channel. */
export function isSubscriptionProvider(provider: { source?: string }): boolean {
  return provider.source === 'subscription';
}

/** BYOK / CPA / custom channel. Omitted `source` is a channel. */
export function isChannelProvider(provider: { source?: string }): boolean {
  return provider.source !== 'subscription';
}

export function isIgnoredSubscriptionProviderId(providerId: string): boolean {
  return IGNORED_SUBSCRIPTION_PROVIDER_IDS.includes(providerId);
}

export const AUTH_CLI_PROVIDER_IDS = V1_SUBSCRIPTION_PROVIDER_IDS.join('|');

/** Prefer the base id; if taken, allocate base-2, base-3, ... */
export function allocateUniqueProviderId(
  preferredId: string,
  existingIds: Iterable<string>,
): string {
  const baseId = preferredId.trim() || 'provider';
  const taken = new Set(
    [...existingIds]
      .map((id) => id.trim())
      .filter((id) => id.length > 0),
  );
  if (!taken.has(baseId)) {
    return baseId;
  }
  let suffix = 2;
  while (taken.has(`${baseId}-${suffix}`)) {
    suffix += 1;
  }
  return `${baseId}-${suffix}`;
}

/** Prefer the base name; if taken, allocate "Name 2", "Name 3", ... */
export function allocateUniqueProviderName(
  preferredName: string,
  existingNames: Iterable<string>,
): string {
  const baseName = preferredName.trim() || 'Provider';
  const taken = new Set(
    [...existingNames]
      .map((name) => name.trim().toLowerCase())
      .filter((name) => name.length > 0),
  );
  if (!taken.has(baseName.toLowerCase())) {
    return baseName;
  }
  let suffix = 2;
  while (taken.has(`${baseName} ${suffix}`.toLowerCase())) {
    suffix += 1;
  }
  return `${baseName} ${suffix}`;
}

export function allocateRelocateChannelId(
  oldId: string,
  existingIds: Iterable<string>,
): string {
  return allocateUniqueProviderId(`${oldId.trim() || 'provider'}-api`, existingIds);
}
