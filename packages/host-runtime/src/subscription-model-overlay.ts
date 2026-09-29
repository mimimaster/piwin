import type { PiwinConfig, SubscriptionAccount } from '@piwin/contracts';
import { isModelEnabled, isProviderEnabled } from '@piwin/contracts';
import type { SubscriptionCatalogModel } from '@piwin/agent-host';
import { narrowCatalogThinkingLevels, overlayCatalogLimits } from './seed-subscription-provider.js';

export type ConfiguredChatModels = {
  defaultProviderId?: string;
  defaultModelId?: string;
  models: Array<Record<string, unknown>>;
};

/** Add live catalog metadata without restoring models disabled in settings. */
export function mergeSubscriptionCatalogModels(
  channelModels: ConfiguredChatModels,
  accounts: readonly SubscriptionAccount[],
  config: Pick<PiwinConfig, 'providers'>,
  chatCatalogFor: (providerId: string) => readonly SubscriptionCatalogModel[],
): ConfiguredChatModels {
  const providerById = new Map(config.providers.map((provider) => [provider.id, provider] as const));
  const models = [...channelModels.models];
  const existing = new Set(models.map((model) => `${model.providerId}::${model.modelId}`));
  for (const account of accounts) {
    if (account.surface !== 'v1' || account.collidingChannelId) continue;
    if (account.state !== 'logged-in' && account.state !== 'sync-error') continue;
    const provider = providerById.get(account.providerId);
    if (provider !== undefined && !isProviderEnabled(provider)) continue;
    for (const model of chatCatalogFor(account.providerId)) {
      const configuredModel = provider?.models.find((entry) => entry.id === model.id);
      if (configuredModel !== undefined && !isModelEnabled(configuredModel)) continue;
      const key = `${account.providerId}::${model.id}`;
      if (existing.has(key)) {
        const current = models.find((entry) => `${entry.providerId}::${entry.modelId}` === key);
        if (current) {
          overlayCatalogLimits(current, model);
          if (!current['input'] && Array.isArray(model.input) && model.input.length > 0) {
            current['input'] = [...model.input];
          }
          if (current['reasoning'] === undefined && typeof model.reasoning === 'boolean') {
            current['reasoning'] = model.reasoning;
          }
          if (Array.isArray(model.thinkingLevels) && model.thinkingLevels.length > 0) {
            const thinkingLevels = narrowCatalogThinkingLevels(
              model.thinkingLevels,
              current['thinkingLevels'],
            );
            if (thinkingLevels) {
              current['thinkingLevels'] = thinkingLevels;
            }
          }
        }
        continue;
      }
      existing.add(key);
      const next: Record<string, unknown> = {
        providerId: account.providerId,
        modelId: model.id,
        label: model.name,
        source: 'subscription',
        group: 'subscription',
      };
      if (model.reasoning !== undefined) next.reasoning = model.reasoning;
      if (model.thinkingLevels) next.thinkingLevels = model.thinkingLevels;
      if (Array.isArray(model.input) && model.input.length > 0) next.input = [...model.input];
      overlayCatalogLimits(next, model);
      models.push(next);
    }
  }
  return { ...channelModels, models };
}
