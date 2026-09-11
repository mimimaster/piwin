/**
 * Resolve the real HTTPS surface for subscription image/video calls.
 * Chat still compiles with `oauth://<id>`; media tools cannot POST there.
 */
import { isSubscriptionProvider, isV1SubscriptionProviderId } from '@piwin/contracts';
import { defaultPiAuthPaths, readOAuthMaterialFromAuthFile } from '@piwin/agent-host';
import { resolveHostPiAgentDir } from './paths.js';

export type SubscriptionMediaAuth = {
  accessToken: string;
  accountId?: string;
};

export type SubscriptionMediaKind = 'image' | 'video';

const CODEX_IMAGE_BASE = 'https://chatgpt.com/backend-api';
const XAI_INFERENCE_BASE = 'https://api.x.ai/v1';

const IMAGE_BASE_BY_PROVIDER: Readonly<Record<string, string>> = {
  'openai-codex': CODEX_IMAGE_BASE,
  xai: XAI_INFERENCE_BASE,
};

const VIDEO_BASE_BY_PROVIDER: Readonly<Record<string, string>> = {
  xai: XAI_INFERENCE_BASE,
};

export function subscriptionMediaBaseUrl(
  providerId: string,
  kind: SubscriptionMediaKind,
): string | undefined {
  if (!isV1SubscriptionProviderId(providerId)) {
    return undefined;
  }
  return kind === 'image' ? IMAGE_BASE_BY_PROVIDER[providerId] : VIDEO_BASE_BY_PROVIDER[providerId];
}

export function resolveSubscriptionMediaUrl(
  providerId: string,
  kind: SubscriptionMediaKind,
  routePath: string,
): string | undefined {
  const base = subscriptionMediaBaseUrl(providerId, kind);
  if (!base) {
    return undefined;
  }
  const path = routePath.startsWith('/') ? routePath : `/${routePath}`;
  return `${base.replace(/\/+$/, '')}${path}`;
}

export function subscriptionMediaHeaders(
  providerId: string,
  auth: SubscriptionMediaAuth,
): Record<string, string> {
  const headers: Record<string, string> = {
    authorization: `Bearer ${auth.accessToken}`,
  };
  if (providerId === 'openai-codex') {
    headers['OpenAI-Beta'] = 'codex-1';
    headers['User-Agent'] = 'piwin-host/1.0';
    if (auth.accountId) {
      headers['ChatGPT-Account-Id'] = auth.accountId;
    }
  }
  if (providerId === 'xai') {
    headers['X-XAI-Token-Auth'] = 'xai-grok-cli';
  }
  return headers;
}

export async function loadSubscriptionMediaAuth(
  providerId: string,
  options?: { authPath?: string; piwinRoot?: string },
): Promise<SubscriptionMediaAuth> {
  const authPath =
    options?.authPath ??
    defaultPiAuthPaths(
      resolveHostPiAgentDir({
        ...(options?.piwinRoot !== undefined ? { piwinRoot: options.piwinRoot } : {}),
      }),
    ).authPath;
  const material = await readOAuthMaterialFromAuthFile(authPath, providerId);
  if (!material?.accessToken) {
    throw new Error(`未找到 ${providerId} 的 OAuth 凭据，请先登录套餐`);
  }
  const auth: SubscriptionMediaAuth = { accessToken: material.accessToken };
  if (material.accountId) {
    auth.accountId = material.accountId;
  }
  return auth;
}

export function providerUsesSubscriptionMedia(
  provider: { id: string; source?: string },
  kind: SubscriptionMediaKind,
): boolean {
  return isSubscriptionProvider(provider) && subscriptionMediaBaseUrl(provider.id, kind) !== undefined;
}
