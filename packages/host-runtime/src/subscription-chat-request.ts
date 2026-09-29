/**
 * Auth for Host-side requests on the subscription HTTPS chat surface; the
 * surface table lives in `@piwin/contracts` (`SUBSCRIPTION_CHAT_SURFACES`).
 */
import {
  isSubscriptionProvider,
  subscriptionChatBaseUrl,
  type ModelProviderConfig,
} from '@piwin/contracts';
import {
  loadSubscriptionMediaAuth,
  subscriptionMediaHeaders,
  type SubscriptionMediaAuth,
} from './subscription-media-request.js';

export { providerUsesSubscriptionChat, subscriptionChatBaseUrl } from '@piwin/contracts';

export function subscriptionChatHeaders(
  providerId: string,
  auth: SubscriptionMediaAuth,
): Record<string, string> {
  return subscriptionMediaHeaders(providerId, auth);
}

export { loadSubscriptionMediaAuth as loadSubscriptionChatAuth };

/**
 * Rewrite a subscription provider into a plain HTTPS provider for Host-side
 * requests that register their own Pi provider (native `web_search`). The
 * OAuth access token becomes the bearer key; the CLI token header rides in
 * provider headers. Returns undefined for providers without an HTTPS chat
 * surface so callers keep their normal path.
 */
export async function resolveSubscriptionChatTarget(
  provider: ModelProviderConfig,
  loadAuth: (providerId: string) => Promise<SubscriptionMediaAuth> = loadSubscriptionMediaAuth,
): Promise<{ provider: ModelProviderConfig; apiKey: string } | undefined> {
  const baseUrl = isSubscriptionProvider(provider) ? subscriptionChatBaseUrl(provider.id) : undefined;
  if (baseUrl === undefined) {
    return undefined;
  }
  const auth = await loadAuth(provider.id);
  // Pi sets `authorization` from apiKey; keep only the extra shaping headers.
  const { authorization: _bearer, ...shaping } = subscriptionChatHeaders(provider.id, auth);
  return {
    provider: { ...provider, baseUrl, headers: { ...provider.headers, ...shaping } },
    apiKey: auth.accessToken,
  };
}
