/**
 * HTTPS chat surface for subscription OAuth providers.
 *
 * Pi chat compiles `oauth://<id>`; code_search's model backend is a Host
 * fetch client and must POST a real URL. Grok reuses the same inference
 * host and CLI token headers as image/video (`api.x.ai`).
 */
import { isSubscriptionProvider, isV1SubscriptionProviderId } from '@piwin/contracts';
import {
  loadSubscriptionMediaAuth,
  subscriptionMediaHeaders,
  type SubscriptionMediaAuth,
} from './subscription-media-request.js';

const XAI_INFERENCE_BASE = 'https://api.x.ai/v1';

const CHAT_BASE_BY_PROVIDER: Readonly<Record<string, string>> = {
  xai: XAI_INFERENCE_BASE,
};

export function subscriptionChatBaseUrl(providerId: string): string | undefined {
  if (!isV1SubscriptionProviderId(providerId)) {
    return undefined;
  }
  return CHAT_BASE_BY_PROVIDER[providerId];
}

export function providerUsesSubscriptionChat(provider: {
  id: string;
  source?: string;
}): boolean {
  return isSubscriptionProvider(provider) && subscriptionChatBaseUrl(provider.id) !== undefined;
}

export function subscriptionChatHeaders(
  providerId: string,
  auth: SubscriptionMediaAuth,
): Record<string, string> {
  return subscriptionMediaHeaders(providerId, auth);
}

export { loadSubscriptionMediaAuth as loadSubscriptionChatAuth };
