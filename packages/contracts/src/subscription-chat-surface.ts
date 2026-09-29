/**
 * Host-reachable HTTPS chat surfaces for subscription OAuth providers.
 *
 * Pi chat compiles `oauth://<id>`; Host-side requests that register their own
 * provider (code_search model backend, native `web_search`) must POST a real
 * URL. Grok reuses the inference host and CLI token headers of its image/video
 * APIs (`api.x.ai`). A subscription without an entry here — Codex, Claude
 * Code, extension subscriptions such as Kiro — has no Host-reachable surface,
 * so it can never run a native `web_search` sub-request.
 */
import type { NativeSearchVendor } from './native-search-adapters.js';
import { isSubscriptionProvider, isV1SubscriptionProviderId } from './subscription-oauth.js';

export const SUBSCRIPTION_CHAT_SURFACES: Readonly<
  Record<string, { baseUrl: string; vendor: NativeSearchVendor }>
> = {
  xai: { baseUrl: 'https://api.x.ai/v1', vendor: 'xai' },
};

export function subscriptionChatBaseUrl(providerId: string): string | undefined {
  if (!isV1SubscriptionProviderId(providerId)) {
    return undefined;
  }
  return SUBSCRIPTION_CHAT_SURFACES[providerId]?.baseUrl;
}

export function providerUsesSubscriptionChat(provider: { id: string; source?: string }): boolean {
  return isSubscriptionProvider(provider) && subscriptionChatBaseUrl(provider.id) !== undefined;
}

/**
 * Why this provider can never run a native `web_search` sub-request, or
 * undefined when it can. Shared by Host readiness and the model editor.
 */
export function nativeSearchProviderBlocker(provider: {
  id: string;
  source?: string;
}): string | undefined {
  if (!isSubscriptionProvider(provider) || subscriptionChatBaseUrl(provider.id) !== undefined) {
    return undefined;
  }
  return `subscription provider ${provider.id} has no Host-reachable endpoint for native web search`;
}
