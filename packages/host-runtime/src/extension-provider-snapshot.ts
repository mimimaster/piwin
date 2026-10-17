import type { PiwinConfig, SubscriptionAccount } from '@piwin/contracts';
import type { ResolveChatModelAccounts } from './resolve-chat-model.js';
import { isSubscriptionAccountUsable } from './resolve-chat-model.js';
import { usablePublicModelProviders } from './extension-model-provider-projection.js';
import type { SubscriptionExtensionProvider } from './subscription-extension-providers.js';

export function buildExtensionProviderSnapshot(
  accounts: readonly SubscriptionAccount[],
  claims: readonly SubscriptionExtensionProvider[],
  config: Pick<PiwinConfig, 'providers'>,
  catalogFor: (providerId: string) => readonly string[],
): ResolveChatModelAccounts {
  const publicModelProviders = usablePublicModelProviders(claims, config);
  const catalogModelIds = new Map<string, readonly string[]>();
  for (const account of accounts) {
    if (isSubscriptionAccountUsable(account)) catalogModelIds.set(account.providerId, catalogFor(account.providerId));
  }
  for (const claim of publicModelProviders) catalogModelIds.set(claim.providerId, catalogFor(claim.providerId));
  return {
    accounts, catalogModelIds, publicModelProviders,
    extensionProviders: claims.filter((claim) => claim.kind !== 'model'),
  };
}
