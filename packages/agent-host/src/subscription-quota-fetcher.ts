/**
 * Fetch subscription quota from each vendor's live endpoint, then normalize.
 * Tokens come from Pi auth.json. Expired access tokens are refreshed once via
 * ModelRuntime before retrying; failures surface as quota.error, never invented %.
 */

import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { SubscriptionAccountQuota } from '@piwin/contracts';
import {
  normalizeClaudeUsagePayload,
  normalizeCodexUsagePayload,
  normalizeCopilotUsagePayload,
  normalizeDevinUsagePayload,
  normalizeGrokUsagePayload,
  normalizeKimiUsagePayload,
  quotaErrorResult,
} from './subscription-quota-normalize.js';
import { DEVIN_HOST, normalizeSessionToken } from './devin/protocol.js';
import {
  asRecord,
  asString,
  extractEmailFromJwt,
  parseTokenCandidate,
  type StoredOAuthMaterial,
} from './subscription-quota-shared.js';

export type { StoredOAuthMaterial } from './subscription-quota-shared.js';
export {
  deriveColorTone,
  formatFriendlyTimeAgoOrUntil,
} from './subscription-quota-shared.js';
export {
  normalizeClaudeUsagePayload,
  normalizeCodexUsagePayload,
  normalizeCopilotUsagePayload,
  normalizeDevinUsagePayload,
  normalizeGrokUsagePayload,
  normalizeKimiUsagePayload,
} from './subscription-quota-normalize.js';

const REQUEST_TIMEOUT_MS = 8_000;
const REFRESH_SKEW_MS = 60_000;
const PIWIN_UA = 'piwin-host/1.0';
const CODEX_USAGE_URL = 'https://chatgpt.com/backend-api/wham/usage';
const CODEX_RESET_CREDITS_URL = 'https://chatgpt.com/backend-api/wham/rate-limit-reset-credits';
const CODEX_CONSUME_URL = 'https://chatgpt.com/backend-api/wham/rate-limit-reset-credits/consume';
const GROK_BILLING_URL = 'https://cli-chat-proxy.grok.com/v1/billing?format=credits';
const GROK_SETTINGS_URL = 'https://cli-chat-proxy.grok.com/v1/settings';
const CLAUDE_USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';
const COPILOT_USER_URL = 'https://api.github.com/copilot_internal/user';
const KIMI_USAGES_URLS = [
  'https://api.kimi.com/coding/v1/usages',
  'https://api.kimi.ai/coding/v1/usages',
] as const;

export async function readOAuthMaterialFromAuthFile(
  authPath: string,
  providerId: string,
): Promise<StoredOAuthMaterial | null> {
  let raw: string;
  try {
    raw = await readFile(authPath, 'utf8');
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const root = asRecord(parsed);
  const entry = asRecord(root?.[providerId]);
  if (!entry) {
    return null;
  }
  const accessToken = parseTokenCandidate(entry);
  if (!accessToken) {
    return null;
  }
  const accountId = asString(entry.accountId);
  const refreshToken = asString(entry.refresh);
  const email = asString(entry.email) ?? extractEmailFromJwt(accessToken);
  const expiresAtMs = typeof entry.expires === 'number' && Number.isFinite(entry.expires) ? entry.expires : undefined;

  return {
    providerId,
    accessToken,
    ...(refreshToken ? { refreshToken } : {}),
    ...(accountId ? { accountId } : {}),
    ...(email ? { email } : {}),
    ...(expiresAtMs !== undefined ? { expiresAtMs } : {}),
  };
}

type JsonResult = {
  status: number;
  ok: boolean;
  json: Record<string, unknown> | undefined;
  text: string;
};

async function fetchJson(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
): Promise<JsonResult> {
  const response = await fetchImpl(url, {
    ...init,
    redirect: 'error',
    signal: init.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const text = await response.text();
  let json: Record<string, unknown> | undefined;
  try {
    json = asRecord(JSON.parse(text));
  } catch {
    json = undefined;
  }
  return { status: response.status, ok: response.ok, json, text };
}

function describeHttpError(status: number, text: string): string {
  if (status === 401 || status === 403) {
    return '登录已过期或凭证无效，请重新登录';
  }
  if (status === 429) {
    return '额度接口限流，请稍后再试';
  }
  if (status === 404) {
    return '额度接口不存在或当前套餐未开放查询';
  }
  const trimmed = text.replace(/\s+/g, ' ').trim().slice(0, 180);
  return `额度接口返回 ${status}${trimmed ? `: ${trimmed}` : ''}`;
}

export type FetchSubscriptionQuotaOptions = {
  authPath: string;
  providerId: string;
  fetchImpl?: typeof fetch;
  nowMs?: number;
  refreshCredentials?: () => Promise<void>;
};

export type ResetSubscriptionQuotaOptions = {
  authPath: string;
  providerId: string;
  fetchImpl?: typeof fetch;
  refreshCredentials?: () => Promise<void>;
};

async function loadMaterial(
  authPath: string,
  providerId: string,
  nowMs: number,
  refreshCredentials: (() => Promise<void>) | undefined,
  alreadyRefreshed: boolean,
): Promise<{ material: StoredOAuthMaterial | null; refreshed: boolean }> {
  let material = await readOAuthMaterialFromAuthFile(authPath, providerId);
  let refreshed = alreadyRefreshed;
  const expired =
    material?.expiresAtMs !== undefined && material.expiresAtMs <= nowMs + REFRESH_SKEW_MS;
  if (expired && refreshCredentials && !refreshed) {
    await refreshCredentials();
    refreshed = true;
    material = await readOAuthMaterialFromAuthFile(authPath, providerId);
  }
  return { material, refreshed };
}

export async function fetchSubscriptionQuota(
  options: FetchSubscriptionQuotaOptions,
): Promise<SubscriptionAccountQuota> {
  const { authPath, providerId, fetchImpl = fetch, nowMs = Date.now(), refreshCredentials } = options;
  let refreshed = false;
  try {
    const loaded = await loadMaterial(authPath, providerId, nowMs, refreshCredentials, false);
    refreshed = loaded.refreshed;
    if (!loaded.material) {
      return quotaErrorResult(providerId, '未找到 OAuth 凭据，请先登录', undefined, nowMs);
    }

    const run = async (material: StoredOAuthMaterial): Promise<SubscriptionAccountQuota> => {
      switch (providerId) {
        case 'openai-codex':
          return fetchCodexQuota(material, fetchImpl, nowMs);
        case 'xai':
          return fetchGrokQuota(material, fetchImpl, nowMs);
        case 'anthropic':
        case 'anthropic-claude-code':
          return fetchClaudeQuota(material, fetchImpl, nowMs, providerId);
        case 'github-copilot':
          return fetchCopilotQuota(material, fetchImpl, nowMs);
        case 'kimi-coding':
          return fetchKimiQuota(material, fetchImpl, nowMs);
        case 'devin':
          return fetchDevinQuota(material, fetchImpl, nowMs);
        default:
          return quotaErrorResult(providerId, `不支持的套餐平台：${providerId}`, material.email, nowMs);
      }
    };

    try {
      return ensureQuotaWindows(await run(loaded.material));
    } catch (error) {
      const status = error instanceof QuotaHttpError ? error.status : undefined;
      if ((status === 401 || status === 403) && refreshCredentials && !refreshed) {
        await refreshCredentials();
        const retried = await readOAuthMaterialFromAuthFile(authPath, providerId);
        if (!retried) {
          return quotaErrorResult(providerId, '登录已过期或凭证无效，请重新登录', undefined, nowMs);
        }
        return ensureQuotaWindows(await run(retried));
      }
      throw error;
    }
  } catch (error) {
    if (error instanceof QuotaHttpError) {
      return quotaErrorResult(providerId, error.message, undefined, nowMs);
    }
    const message = error instanceof Error ? error.message : String(error);
    if (/credential-sync-failed|unauthorized|expired|invalid_grant/i.test(message)) {
      return quotaErrorResult(providerId, '登录已过期或凭证无效，请重新登录', undefined, nowMs);
    }
    return quotaErrorResult(providerId, `读取额度失败：${message}`, undefined, nowMs);
  }
}

function ensureQuotaWindows(quota: SubscriptionAccountQuota): SubscriptionAccountQuota {
  if (quota.error) {
    return quota;
  }
  if (quota.groups.some((group) => group.windows.length > 0)) {
    return quota;
  }
  return { ...quota, error: '厂商未返回可用额度窗口' };
}

class QuotaHttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'QuotaHttpError';
    this.status = status;
  }
}

function requireOk(result: JsonResult, fallbackLabel: string): Record<string, unknown> {
  if (!result.ok || !result.json) {
    throw new QuotaHttpError(result.status, describeHttpError(result.status, result.text || fallbackLabel));
  }
  return result.json;
}

function codexHeaders(material: StoredOAuthMaterial): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${material.accessToken}`,
    Accept: 'application/json',
    'User-Agent': PIWIN_UA,
    'OpenAI-Beta': 'codex-1',
  };
  if (material.accountId) {
    headers['ChatGPT-Account-Id'] = material.accountId;
  }
  return headers;
}

async function fetchCodexQuota(
  material: StoredOAuthMaterial,
  fetchImpl: typeof fetch,
  nowMs: number,
): Promise<SubscriptionAccountQuota> {
  const headers = codexHeaders(material);
  const [usageResult, creditsResult] = await Promise.all([
    fetchJson(fetchImpl, CODEX_USAGE_URL, { headers }),
    fetchJson(fetchImpl, CODEX_RESET_CREDITS_URL, { headers }),
  ]);
  const usage = requireOk(usageResult, 'wham/usage');
  const credits = creditsResult.ok ? creditsResult.json : undefined;
  const email = material.email ?? asString(usage.email) ?? extractEmailFromJwt(material.accessToken);
  return normalizeCodexUsagePayload(usage, email, nowMs, credits);
}

async function fetchGrokQuota(
  material: StoredOAuthMaterial,
  fetchImpl: typeof fetch,
  nowMs: number,
): Promise<SubscriptionAccountQuota> {
  const headers = {
    Authorization: `Bearer ${material.accessToken}`,
    Accept: 'application/json',
    'User-Agent': PIWIN_UA,
    'X-XAI-Token-Auth': 'xai-grok-cli',
  };
  const [billingResult, settingsResult] = await Promise.all([
    fetchJson(fetchImpl, GROK_BILLING_URL, { headers }),
    fetchJson(fetchImpl, GROK_SETTINGS_URL, { headers }),
  ]);
  const billing = requireOk(billingResult, 'grok billing');
  const settings = settingsResult.ok ? settingsResult.json : undefined;
  return normalizeGrokUsagePayload(
    billing,
    material.email ?? extractEmailFromJwt(material.accessToken),
    nowMs,
    settings,
  );
}

async function fetchClaudeQuota(
  material: StoredOAuthMaterial,
  fetchImpl: typeof fetch,
  nowMs: number,
  providerId: string,
): Promise<SubscriptionAccountQuota> {
  const result = await fetchJson(fetchImpl, CLAUDE_USAGE_URL, {
    headers: {
      Authorization: `Bearer ${material.accessToken}`,
      Accept: 'application/json',
      'User-Agent': 'claude-cli/2.1.0',
      'anthropic-beta': 'oauth-2025-04-20',
    },
  });
  const json = requireOk(result, 'claude usage');
  return normalizeClaudeUsagePayload(
    json,
    material.email ?? extractEmailFromJwt(material.accessToken),
    nowMs,
    providerId,
  );
}

async function fetchCopilotQuota(
  material: StoredOAuthMaterial,
  fetchImpl: typeof fetch,
  nowMs: number,
): Promise<SubscriptionAccountQuota> {
  const result = await fetchJson(fetchImpl, COPILOT_USER_URL, {
    headers: {
      Authorization: `Bearer ${material.accessToken}`,
      Accept: 'application/json',
      'User-Agent': 'GitHubCopilotChat/0.35.0',
      'Editor-Version': 'vscode/1.107.0',
      'Editor-Plugin-Version': 'copilot-chat/0.35.0',
      'X-Github-Api-Version': '2026-06-01',
    },
  });
  const json = requireOk(result, 'copilot user');
  return normalizeCopilotUsagePayload(json, material.email ?? asString(json.login), nowMs);
}

async function fetchKimiQuota(
  material: StoredOAuthMaterial,
  fetchImpl: typeof fetch,
  nowMs: number,
): Promise<SubscriptionAccountQuota> {
  const headers = {
    Authorization: `Bearer ${material.accessToken}`,
    Accept: 'application/json',
    'User-Agent': PIWIN_UA,
  };
  let lastError: QuotaHttpError | undefined;
  for (const url of KIMI_USAGES_URLS) {
    const result = await fetchJson(fetchImpl, url, { headers });
    if (result.ok && result.json) {
      return normalizeKimiUsagePayload(
        result.json,
        material.email ?? extractEmailFromJwt(material.accessToken),
        nowMs,
      );
    }
    lastError = new QuotaHttpError(result.status, describeHttpError(result.status, result.text || 'kimi usages'));
    if (result.status !== 404) {
      throw lastError;
    }
  }
  throw lastError ?? new QuotaHttpError(404, '额度接口不存在或当前套餐未开放查询');
}

const DEVIN_QUOTA_URL = `${DEVIN_HOST}/exa.seat_management_pb.SeatManagementService/GetUserStatus`;

async function fetchDevinQuota(
  material: StoredOAuthMaterial,
  fetchImpl: typeof fetch,
  nowMs: number,
): Promise<SubscriptionAccountQuota> {
  const result = await fetchJson(fetchImpl, DEVIN_QUOTA_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'connect-protocol-version': '1',
      Accept: 'application/json',
      'User-Agent': PIWIN_UA,
    },
    body: JSON.stringify({
      metadata: {
        apiKey: normalizeSessionToken(material.accessToken),
        ideName: 'devin',
        ideVersion: '1.108.2',
        extensionName: 'devin',
        extensionVersion: '1.108.2',
        locale: 'en',
      },
    }),
  });
  const json = requireOk(result, 'devin quota');
  return normalizeDevinUsagePayload(
    json,
    material.email ?? extractEmailFromJwt(material.accessToken),
    nowMs,
  );
}

export async function resetSubscriptionQuota(
  options: ResetSubscriptionQuotaOptions,
): Promise<{ ok: boolean; message?: string; quota?: SubscriptionAccountQuota }> {
  const { authPath, providerId, fetchImpl = fetch, refreshCredentials } = options;
  if (providerId !== 'openai-codex') {
    return {
      ok: false,
      message: `重置额度仅适用于 ChatGPT Codex（${providerId} 不支持主动重置）`,
    };
  }

  const nowMs = Date.now();
  let loaded: { material: StoredOAuthMaterial | null; refreshed: boolean };
  try {
    loaded = await loadMaterial(authPath, providerId, nowMs, refreshCredentials, false);
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
  if (!loaded.material) {
    return { ok: false, message: '未找到 OAuth 凭据' };
  }

  const consume = async (material: StoredOAuthMaterial): Promise<JsonResult> =>
    fetchJson(fetchImpl, CODEX_CONSUME_URL, {
      method: 'POST',
      headers: {
        ...codexHeaders(material),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ idempotency_key: randomUUID() }),
    });

  try {
    let result = await consume(loaded.material);
    if ((result.status === 401 || result.status === 403) && refreshCredentials && !loaded.refreshed) {
      await refreshCredentials();
      const retried = await readOAuthMaterialFromAuthFile(authPath, providerId);
      if (!retried) {
        return { ok: false, message: '登录已过期或凭证无效，请重新登录' };
      }
      result = await consume(retried);
    }
    if (!result.ok) {
      return { ok: false, message: describeHttpError(result.status, result.text) };
    }
    const code = asString(result.json?.code);
    if (code && /nothing|ineligible|not_applicable|nothingToReset/i.test(code)) {
      return { ok: false, message: `当前无法重置：${code}` };
    }
    const quota = await fetchSubscriptionQuota({
      authPath,
      providerId,
      fetchImpl,
      ...(refreshCredentials ? { refreshCredentials } : {}),
    });
    return { ok: true, quota, message: '额度已重置成功' };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}
