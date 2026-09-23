/**
 * Provider selection helpers that respect the `enabled` flag.
 * Disabled providers are still saved in config but are ignored by the host.
 */
import type {
  ModelConfigEntry,
  ModelProviderConfig,
  ModelRef,
  PiwinConfig,
} from '@piwin/contracts';
import {
  isChannelProvider,
  isModelEnabled,
  isProviderEnabled,
  modelSupportsCapability,
} from '@piwin/contracts';
import { SUBSCRIPTION_DEFAULT_FALLBACK_ORDER } from '@piwin/contracts';
import {
  isSubscriptionAccountUsable,
  resolveChatModel,
  type ResolveChatModelAccounts,
} from './resolve-chat-model.js';

export function getEnabledProviders(config: {
  readonly providers: readonly ModelProviderConfig[];
}): ModelProviderConfig[] {
  return config.providers.filter((provider) => isProviderEnabled(provider));
}

export function findEnabledProvider(
  config: { providers: readonly ModelProviderConfig[] },
  providerId: string,
): ModelProviderConfig | undefined {
  return config.providers.find(
    (provider) => provider.id === providerId && isProviderEnabled(provider),
  );
}

export function findEnabledModel(
  config: { providers: readonly ModelProviderConfig[] },
  providerId: string,
  modelId: string,
): ModelConfigEntry | undefined {
  return findEnabledProvider(config, providerId)?.models.find(
    (model) => model.id === modelId && isModelEnabled(model),
  );
}

/**
 * Resolve the explicitly configured default model (defaultProviderId/defaultModelId).
 * Returns undefined when no default is configured, the provider is disabled, or the
 * model is not present. Does NOT fall back to the first enabled provider — callers
 * that want a fallback should use {@link resolveDefaultModelRef} instead.
 */
/** Minimal config slice needed for default model resolution (tests + host). */
export type DefaultModelConfigSlice = {
  providers: readonly ModelProviderConfig[];
  defaultProviderId?: string;
  defaultModelId?: string;
};

export function resolveConfiguredDefaultModelRef(
  config: DefaultModelConfigSlice | PiwinConfig,
  accounts: ResolveChatModelAccounts = { accounts: [] },
): ModelRef | undefined {
  if (!config.defaultProviderId || !config.defaultModelId) {
    return undefined;
  }
  return resolveChatModel(
    { providers: [...config.providers] },
    {
      providerId: config.defaultProviderId,
      modelId: config.defaultModelId,
    },
    accounts,
  )?.ref;
}

/**
 * Resolve the default chat model, falling back to the first enabled provider/model
 * when the configured default is disabled or missing.
 */
export function resolveDefaultModelRef(
  config: DefaultModelConfigSlice | PiwinConfig,
  accounts: ResolveChatModelAccounts = { accounts: [] },
): ModelRef | undefined {
  const configured = resolveConfiguredDefaultModelRef(config, accounts);
  if (configured) {
    return configured;
  }
  for (const providerId of SUBSCRIPTION_DEFAULT_FALLBACK_ORDER) {
    const account = accounts.accounts.find((entry) => entry.providerId === providerId);
    if (!isSubscriptionAccountUsable(account)) {
      continue;
    }
    const modelId = accounts.catalogModelIds?.get(providerId)?.[0];
    if (!modelId) {
      continue;
    }
    return { providerId, modelId, source: 'subscription' };
  }
  const enabled = getEnabledProviders(config).filter(isChannelProvider);
  if (enabled.length === 0) {
    return undefined;
  }

  if (config.defaultProviderId && config.defaultModelId) {
    const provider = findEnabledProvider(config, config.defaultProviderId);
    if (
      provider?.models.some(
        (model) =>
          model.id === config.defaultModelId &&
          isModelEnabled(model) &&
          modelSupportsCapability(model, 'chat'),
      )
    ) {
      return {
        protocol: provider.protocol,
        providerId: provider.id,
        modelId: config.defaultModelId,
        source: 'channel',
      };
    }
  }

  const first = enabled[0];
  if (!first) {
    return undefined;
  }
  const firstModel = first.models.find(
    (model) => isModelEnabled(model) && modelSupportsCapability(model, 'chat'),
  );
  if (!firstModel) {
    return undefined;
  }
  return {
    protocol: first.protocol,
    providerId: first.id,
    modelId: firstModel.id,
    source: 'channel',
  };
}

export function listKnownChatModelKeys(config: PiwinConfig): string[] {
  return (config.providers ?? [])
    .filter((provider) => isProviderEnabled(provider))
    .flatMap((provider) =>
      provider.models
        .filter((model) => isModelEnabled(model) && modelSupportsCapability(model, 'chat'))
        .map((model) => `${provider.id}::${model.id}`),
    );
}
