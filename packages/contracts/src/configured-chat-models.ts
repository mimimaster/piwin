/**
 * Secret-free chat model list for remote shells.
 * Never include apiKey*, baseUrl, headers, or Host paths.
 */
import type {
  ModelCapability,
  ModelInputModality,
  ModelProviderConfig,
  PiwinConfig,
} from './config.js';
import { isModelEnabled, isProviderEnabled, modelSupportsCapability } from './config.js';
import { isThinkingLevel, type ThinkingLevel } from './host.js';
import type { ConfiguredChatModelGroup, ModelSource } from './subscription-oauth.js';

export type ConfiguredChatModel = {
  providerId: string;
  protocol?: ModelProviderConfig['protocol'];
  modelId: string;
  label?: string;
  thinkingLevel?: ThinkingLevel;
  thinkingLevels?: readonly ThinkingLevel[];
  reasoning?: boolean;
  input?: readonly ModelInputModality[];
  capabilities?: readonly ModelCapability[];
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
      } else if (model.thinkingLevels !== undefined && model.thinkingLevels.length > 0) {
        const defaultLevel = model.thinkingLevels.includes('medium')
          ? 'medium'
          : model.thinkingLevels[0];
        if (defaultLevel !== undefined) {
          entry.thinkingLevel = defaultLevel;
        }
      }
      if (model.thinkingLevels !== undefined && model.thinkingLevels.length > 0) {
        entry.thinkingLevels = model.thinkingLevels;
      }
      if (typeof model.reasoning === 'boolean') {
        entry.reasoning = model.reasoning;
      }
      if (model.input !== undefined && model.input.length > 0) {
        entry.input = model.input;
      }
      if (model.capabilities !== undefined && model.capabilities.length > 0) {
        entry.capabilities = model.capabilities;
      }
      assignPositiveInteger(entry, 'contextWindow', model.contextWindow);
      assignPositiveInteger(entry, 'maxOutputTokens', model.maxOutputTokens);
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

/**
 * Parse the secret-free `models/configured` payload.
 * Copies chat identity plus non-secret model limits (context window / max output).
 */
export function readConfiguredChatModelsData(data: unknown): ConfiguredChatModelsData {
  const record = isRecord(data) ? data : undefined;
  const models: ConfiguredChatModel[] = [];
  const rawModels = record?.models;
  if (Array.isArray(rawModels)) {
    for (const item of rawModels) {
      const model = readConfiguredChatModel(item);
      if (model) {
        models.push(model);
      }
    }
  }
  const next: ConfiguredChatModelsData = { models };
  if (typeof record?.defaultProviderId === 'string' && record.defaultProviderId.length > 0) {
    next.defaultProviderId = record.defaultProviderId;
  }
  if (typeof record?.defaultModelId === 'string' && record.defaultModelId.length > 0) {
    next.defaultModelId = record.defaultModelId;
  }
  return next;
}

export function readConfiguredChatModel(item: unknown): ConfiguredChatModel | undefined {
  if (!isRecord(item) || typeof item.providerId !== 'string' || typeof item.modelId !== 'string') {
    return undefined;
  }
  const protocol = item.protocol;
  const isChannelProtocol =
    protocol === 'openai-compatible' ||
    protocol === 'anthropic-compatible' ||
    protocol === 'google-gemini';
  const isSubscription = item.source === 'subscription';
  if (!isChannelProtocol && !isSubscription) {
    return undefined;
  }
  const model: ConfiguredChatModel = {
    providerId: item.providerId,
    modelId: item.modelId,
    source: isSubscription ? 'subscription' : 'channel',
    group: isSubscription ? 'subscription' : 'channel',
  };
  if (isChannelProtocol) {
    model.protocol = protocol;
  }
  if (typeof item.label === 'string' && item.label.trim().length > 0) {
    model.label = item.label;
  }
  if (isThinkingLevel(item.thinkingLevel)) {
    model.thinkingLevel = item.thinkingLevel;
  }
  if (Array.isArray(item.thinkingLevels)) {
    const thinkingLevels = item.thinkingLevels.filter(isThinkingLevel);
    if (thinkingLevels.length > 0) {
      model.thinkingLevels = thinkingLevels;
    }
  }
  if (typeof item.reasoning === 'boolean') {
    model.reasoning = item.reasoning;
  }
  if (Array.isArray(item.input)) {
    const input = item.input.filter(
      (m): m is ModelInputModality => m === 'text' || m === 'image',
    );
    if (input.length > 0) {
      model.input = input;
    }
  }
  if (Array.isArray(item.capabilities)) {
    const capabilities = item.capabilities.filter(
      (c): c is ModelCapability =>
        c === 'chat' ||
        c === 'image-generation' ||
        c === 'video-generation' ||
        c === 'speech-to-text' ||
        c === 'text-to-speech' ||
        c === 'realtime-audio' ||
        c === 'native-web-search',
    );
    if (capabilities.length > 0) {
      model.capabilities = capabilities;
    }
  }
  assignPositiveInteger(model, 'contextWindow', item.contextWindow);
  assignPositiveInteger(model, 'maxOutputTokens', item.maxOutputTokens);
  return model;
}

function assignPositiveInteger(
  target: ConfiguredChatModel,
  key: 'contextWindow' | 'maxOutputTokens',
  value: unknown,
): void {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) {
    target[key] = value;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
