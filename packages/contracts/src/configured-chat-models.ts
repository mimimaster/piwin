/**
 * Secret-free chat model list for remote shells.
 * Never include apiKey*, baseUrl, headers, or Host paths.
 */
import type { ModelProviderConfig, PiwinConfig } from './config.js';
import { isModelEnabled, isProviderEnabled, modelSupportsCapability } from './config.js';
import type { ThinkingLevel } from './host.js';
import type { ConfiguredChatModelGroup, ModelSource } from './subscription-oauth.js';

export type ConfiguredChatModel = {
  providerId: string;
  protocol?: ModelProviderConfig['protocol'];
  modelId: string;
  label?: string;
  thinkingLevel?: ThinkingLevel;
  thinkingLevels?: readonly ThinkingLevel[];
  reasoning?: boolean;
  contextWindow?: number;
  maxOutputTokens?: number;
  source?: ModelSource;
  group?: ConfiguredChatModelGroup;
};

export type ConfiguredChatModelsData = {
  defaultProviderId?: string;
  defaultModelId?: string;
  models: ConfiguredChatModel[];
};

export function projectConfiguredChatModels(
  config: Pick<PiwinConfig, 'providers' | 'defaultProviderId' | 'defaultModelId'>,
): ConfiguredChatModelsData {
  const models: ConfiguredChatModel[] = [];
  for (const provider of config.providers) {
    if (!isProviderEnabled(provider)) {
      continue;
    }
    for (const model of provider.models) {
      if (!isModelEnabled(model) || !modelSupportsCapability(model, 'chat')) {
        continue;
      }
      const isSubscription = provider.source === 'subscription';
      const entry: ConfiguredChatModel = {
        providerId: provider.id,
        modelId: model.id,
        source: isSubscription ? 'subscription' : 'channel',
        group: isSubscription ? 'subscription' : 'channel',
      };
      if (!isSubscription) {
        entry.protocol = provider.protocol;
      }
      if (typeof model.label === 'string' && model.label.trim().length > 0) {
        entry.label = model.label;
      }
      if (model.thinkingLevel !== undefined) {
        entry.thinkingLevel = model.thinkingLevel;
      }
      if (model.thinkingLevels !== undefined && model.thinkingLevels.length > 0) {
        entry.thinkingLevels = model.thinkingLevels;
      }
      if (typeof model.reasoning === 'boolean') {
        entry.reasoning = model.reasoning;
      }
      models.push(entry);
    }
  }

  const data: ConfiguredChatModelsData = { models };
  if (typeof config.defaultProviderId === 'string' && config.defaultProviderId.length > 0) {
    data.defaultProviderId = config.defaultProviderId;
  }
  if (typeof config.defaultModelId === 'string' && config.defaultModelId.length > 0) {
    data.defaultModelId = config.defaultModelId;
  }
  return data;
}
