/**
 * Subscription providers owned by an extension exist in Pi only after that
 * extension calls `registerProvider`. Sessions therefore load the owning
 * extension of every usable extension account, independent of resource
 * discovery (pure-chat sessions discover nothing) and of any provider id.
 */
import type { ResourceInstance, ResourceManifest } from '@piwin/contracts';
import { isSubscriptionOauthProviderId } from '@piwin/contracts';
import type { ResolveChatModelAccounts } from './resolve-chat-model.js';
import { isSubscriptionAccountUsable } from './resolve-chat-model.js';

export function subscriptionExtensionResources(
  subscription: ResolveChatModelAccounts | undefined,
): ResourceInstance[] {
  if (!subscription) {
    return [];
  }
  const usable = new Set(
    subscription.accounts
      .filter((account) => account.extension !== undefined && isSubscriptionAccountUsable(account))
      .map((account) => account.providerId),
  );
  return [
    ...(subscription.extensionProviders ?? []).filter((provider) => usable.has(provider.providerId)),
    ...(subscription.publicModelProviders ?? []),
  ]
    .map((provider) => ({
      resourceId: `extension:subscription:${provider.providerId}`,
      kind: 'extension',
      name: provider.displayName ?? provider.providerId,
      path: provider.entryPath,
      source: 'user',
      modelProviderId: provider.providerId,
      ...(provider.contentRevision ? { contentRevision: provider.contentRevision } : {}),
    }));
}

/** Append without duplicating an extension discovery already activated. */
export function withSubscriptionExtensions(
  manifest: ResourceManifest,
  subscription: ResolveChatModelAccounts | undefined,
): ResourceManifest {
  const byPath = new Map(manifest.extensions.map((resource) => [resource.path, resource]));
  for (const resource of subscriptionExtensionResources(subscription)) {
    byPath.set(resource.path, { ...byPath.get(resource.path), ...resource });
  }
  return { ...manifest, extensions: [...byPath.values()] };
}

/**
 * True when the id names a subscription provider this Host knows: built-in
 * ids, or any account the Host listed (which includes extension claims).
 */
export function isKnownSubscriptionProviderId(
  providerId: string,
  subscription: ResolveChatModelAccounts | undefined,
): boolean {
  return (
    isSubscriptionOauthProviderId(providerId) ||
    (subscription?.accounts.some((account) => account.providerId === providerId) ?? false)
  );
}
