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
import { isModelEnabled, isProviderEnabled, modelSupportsCapability } from '@piwin/contracts';

export function getEnabledProviders(config: {
  providers: readonly ModelProviderConfig[];
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
): ModelRef | undefined {
  if (!config.defaultProviderId || !config.defaultModelId) {
    return undefined;
  }
  const provider = findEnabledProvider(config, config.defaultProviderId);
  if (
    !provider ||
    !provider.models.some(
      (model) =>
        model.id === config.defaultModelId &&
        isModelEnabled(model) &&
        modelSupportsCapability(model, 'chat'),
    )
  ) {
    return undefined;
  }
  return {
    protocol: provider.protocol,
    providerId: provider.id,
    modelId: config.defaultModelId,
  };
}

/**
 * Resolve the default chat model, falling back to the first enabled provider/model
 * when the configured default is disabled or missing.
 */
export function resolveDefaultModelRef(
  config: DefaultModelConfigSlice | PiwinConfig,
): ModelRef | undefined {
  const configured = resolveConfiguredDefaultModelRef(config);
  if (configured) {
    return configured;
  }
  const enabled = getEnabledProviders(config);
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
  };
}
