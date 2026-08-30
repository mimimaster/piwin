import {
  isChannelProvider,
  isModelEnabled,
  isSubscriptionProvider,
  isV1SubscriptionProviderId,
  modelSupportsCapability,
  type ModelRef,
  type SubscriptionAccount,
} from '@piwin/contracts';
import { findEnabledModel, findEnabledProvider } from './provider-helpers.js';

export type ResolveChatModelAccounts = {
  accounts: readonly SubscriptionAccount[];
  catalogModelIds?: ReadonlyMap<string, readonly string[]>;
};

export type ResolvedChatModel = {
  ref: ModelRef;
  source: 'channel' | 'subscription';
};

/**
 * Resolve a composer/session ModelRef against channels and v1 subscription accounts.
 */
export function resolveChatModel(
  config: { providers: readonly import('@piwin/contracts').ModelProviderConfig[] },
  ref: ModelRef,
  accounts: ResolveChatModelAccounts = { accounts: [] },
): ResolvedChatModel | undefined {
  if (ref.source === 'subscription') {
    return resolveSubscription(ref, config, accounts);
  }
  if (ref.source === 'channel') {
    return resolveChannel(config, ref);
  }
  const channel = resolveChannel(config, ref);
  if (channel) {
    return channel;
  }
  return resolveSubscription(ref, config, accounts);
}

export function isSubscriptionAccountUsable(account: SubscriptionAccount | undefined): boolean {
  return (
    account !== undefined &&
    account.surface === 'v1' &&
    account.collidingChannelId === undefined &&
    (account.state === 'logged-in' || account.state === 'sync-error')
  );
}

function resolveChannel(
  config: { providers: readonly import('@piwin/contracts').ModelProviderConfig[] },
  ref: ModelRef,
): ResolvedChatModel | undefined {
  const provider = findEnabledProvider(config, ref.providerId);
  if (!provider || isSubscriptionProvider(provider)) {
    return undefined;
  }
  const model = findEnabledModel(config, ref.providerId, ref.modelId);
  if (!model || !modelSupportsCapability(model, 'chat')) {
    return undefined;
  }
  return {
    source: 'channel',
    ref: {
      providerId: provider.id,
      modelId: model.id,
      protocol: provider.protocol,
      source: 'channel',
    },
  };
}

function resolveSubscription(
  ref: ModelRef,
  config: { providers: readonly import('@piwin/contracts').ModelProviderConfig[] },
  accounts: ResolveChatModelAccounts,
): ResolvedChatModel | undefined {
  if (!isV1SubscriptionProviderId(ref.providerId)) {
    return undefined;
  }
  if (config.providers.some((provider) => provider.id === ref.providerId && isChannelProvider(provider))) {
    return undefined;
  }
  const account = accounts.accounts.find((entry) => entry.providerId === ref.providerId);
  if (!isSubscriptionAccountUsable(account)) {
    return undefined;
  }
  const seeded = config.providers.find(
    (provider) => provider.id === ref.providerId && isSubscriptionProvider(provider),
  );
  if (seeded) {
    const model = seeded.models.find(
      (entry) =>
        entry.id === ref.modelId &&
        isModelEnabled(entry) &&
        modelSupportsCapability(entry, 'chat'),
    );
    if (!model) {
      return undefined;
    }
    return {
      source: 'subscription',
      ref: {
        providerId: ref.providerId,
        modelId: ref.modelId,
        source: 'subscription',
      },
    };
  }
  const catalog = accounts.catalogModelIds?.get(ref.providerId);
  if (catalog && !catalog.includes(ref.modelId)) {
    return undefined;
  }
  return {
    source: 'subscription',
    ref: {
      providerId: ref.providerId,
      modelId: ref.modelId,
      source: 'subscription',
    },
  };
}
