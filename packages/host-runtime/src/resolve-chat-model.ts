import {
  isChannelProvider,
  isExtensionProvider,
  isProviderEnabled,
  isModelEnabled,
  isSubscriptionProvider,
  modelSupportsCapability,
  type ModelRef,
  type SubscriptionAccount,
} from '@piwin/contracts';
import { findEnabledModel, findEnabledProvider } from './provider-helpers.js';
import type { SubscriptionExtensionProvider } from './subscription-extension-providers.js';

export type ResolveChatModelAccounts = {
  accounts: readonly SubscriptionAccount[];
  catalogModelIds?: ReadonlyMap<string, readonly string[]>;
  /**
   * Enabled extensions that own subscription providers. Sessions must load the
   * owning extension so Pi can resolve its models; the compiler reads this
   * snapshot instead of touching the extension store itself.
   */
  extensionProviders?: readonly SubscriptionExtensionProvider[];
  publicModelProviders?: readonly SubscriptionExtensionProvider[];
};

export type ResolvedChatModel = {
  ref: ModelRef;
  source: 'channel' | 'subscription' | 'extension';
};

/**
 * Resolve a composer/session ModelRef against channels and v1 subscription accounts.
 */
export function resolveChatModel(
  config: { providers: readonly import('@piwin/contracts').ModelProviderConfig[] },
  ref: ModelRef,
  accounts: ResolveChatModelAccounts = { accounts: [] },
): ResolvedChatModel | undefined {
  if (ref.source === 'extension') return resolveExtension(config, ref, accounts);
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
  return resolveExtension(config, ref, accounts) ?? resolveSubscription(ref, config, accounts);
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
  if (!provider || !isChannelProvider(provider)) {
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

function resolveExtension(
  config: { providers: readonly import('@piwin/contracts').ModelProviderConfig[] },
  ref: ModelRef,
  accounts: ResolveChatModelAccounts,
): ResolvedChatModel | undefined {
  const live = accounts.publicModelProviders;
  const claim = live?.find((provider) => provider.providerId === ref.providerId);
  if (live !== undefined && !claim) return undefined;
  const provider = config.providers.find((entry) => entry.id === ref.providerId);
  if (provider && (!isExtensionProvider(provider) || !isProviderEnabled(provider))) return undefined;
  if (!provider && !claim) return undefined;
  const model = provider?.models.find((entry) => entry.id === ref.modelId && isModelEnabled(entry) && modelSupportsCapability(entry, 'chat'));
  if (provider && !model) return undefined;
  if (!provider && !accounts.catalogModelIds?.get(ref.providerId)?.includes(ref.modelId)) return undefined;
  return { source: 'extension', ref: { providerId: ref.providerId, modelId: ref.modelId, source: 'extension' } };
}

function resolveSubscription(
  ref: ModelRef,
  config: { providers: readonly import('@piwin/contracts').ModelProviderConfig[] },
  accounts: ResolveChatModelAccounts,
): ResolvedChatModel | undefined {
  // Accounts cover built-in ids and enabled extension claims; no id allowlist here.
  if (config.providers.some((provider) => provider.id === ref.providerId && !isSubscriptionProvider(provider))) {
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
