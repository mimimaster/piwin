/**
 * Builds the flat, enabled model option list used by the composer and the
 * sub-agent profile pickers.
 *
 * Both the provider and the model must be enabled (contracts' isProviderEnabled
 * / isModelEnabled). A disabled provider never reaches the host's ModelRuntime
 * (the host only registers providers from getEnabledProviders), so listing its
 * models here would let the user pick a model the session layer then rejects
 * with "Configured model is unavailable: <providerId>/<modelId>".
 *
 * Chat pickers block only auxiliary-only models: pure image-generation,
 * video-generation, speech-to-text, and text-to-speech entries live on
 * dedicated settings pages and are not valid chat session models. Everything
 * else — plain chat models, native-web-search models (which imply the chat
 * surface), and hybrids that also declare `chat` — remains available. The
 * judgment is delegated to contracts' modelSupportsCapability so the picker
 * can never drift from what agent-host actually accepts for sessions.
 */
import {
  isModelEnabled,
  isProviderEnabled,
  isThinkingLevel,
  modelSupportsCapability,
  type ConfiguredChatModel,
  type ConfiguredChatModelsData,
  type ModelConfigEntry,
  type ModelProviderConfig,
  type ThinkingLevel,
} from '@piwin/contracts';

export type ModelOption = {
  providerId: string;
  protocol: ModelProviderConfig['protocol'];
  modelId: string;
  label: string;
  contextWindow?: number;
  maxOutputTokens?: number;
  /** Configured thinking level default for this model. */
  thinkingLevel?: ThinkingLevel;
  /** Configured thinking effort levels supported by this model. */
  thinkingLevels?: readonly ThinkingLevel[];
  /** True when model.reasoning is enabled. */
  reasoning?: boolean;
  /** True when model.input includes image. */
  supportsImage?: boolean;
  /** True when model.capabilities includes image-generation. */
  supportsImageGeneration?: boolean;
};

/**
 * Whether a model belongs in the composer / sub-agent chat model pickers.
 *
 * Delegates to contracts' modelSupportsCapability('chat'): omitted or empty
 * `capabilities` defaults to chat, `native-web-search` implies the chat
 * surface, and only pure auxiliary models (image/video generation, speech)
 * are blocked — identical to what agent-host accepts for sessions.
 */
export function isComposerChatModel(model: ModelConfigEntry): boolean {
  return modelSupportsCapability(model, 'chat');
}

/** Remote shells cannot read `config/get`; this is the secret-free picker list. */
export function modelOptionsFromConfiguredModels(
  models: readonly ConfiguredChatModel[],
): ModelOption[] {
  return models.map((model) => ({
    providerId: model.providerId,
    protocol: model.protocol,
    modelId: model.modelId,
    label:
      typeof model.label === 'string' && model.label.trim().length > 0
        ? `${model.providerId} / ${model.label}`
        : `${model.providerId} / ${model.modelId}`,
    ...(model.thinkingLevel ? { thinkingLevel: model.thinkingLevel } : {}),
    ...(model.thinkingLevels ? { thinkingLevels: model.thinkingLevels } : {}),
    ...(model.reasoning !== undefined ? { reasoning: model.reasoning } : {}),
  }));
}

export function readConfiguredChatModelsData(data: unknown): ConfiguredChatModelsData {
  const record = isRecord(data) ? data : undefined;
  const models: ConfiguredChatModel[] = [];
  const rawModels = record?.models;
  if (Array.isArray(rawModels)) {
    for (const item of rawModels) {
      if (!isRecord(item) || typeof item.providerId !== 'string' || typeof item.modelId !== 'string') {
        continue;
      }
      if (
        item.protocol !== 'openai-compatible' &&
        item.protocol !== 'anthropic-compatible' &&
        item.protocol !== 'google-gemini'
      ) {
        continue;
      }
      const model: ConfiguredChatModel = {
        providerId: item.providerId,
        protocol: item.protocol,
        modelId: item.modelId,
      };
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
      models.push(model);
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function buildEnabledModelOptions(
  providers: readonly ModelProviderConfig[],
): ModelOption[] {
  const options: ModelOption[] = [];
  for (const provider of providers) {
    if (!isProviderEnabled(provider)) {
      continue;
    }
    for (const model of provider.models) {
      if (!isModelEnabled(model)) {
        continue;
      }
      if (!isComposerChatModel(model)) {
        continue;
      }
      options.push({
        providerId: provider.id,
        protocol: provider.protocol,
        modelId: model.id,
        label: `${provider.name} / ${model.label ?? model.id}`,
        ...(typeof model.contextWindow === 'number' ? { contextWindow: model.contextWindow } : {}),
        ...(typeof model.maxOutputTokens === 'number'
          ? { maxOutputTokens: model.maxOutputTokens }
          : {}),
        ...(model.thinkingLevel ? { thinkingLevel: model.thinkingLevel } : {}),
        ...(model.thinkingLevels ? { thinkingLevels: model.thinkingLevels } : {}),
        ...(model.reasoning !== undefined ? { reasoning: model.reasoning } : {}),
        ...(model.input?.includes('image') ? { supportsImage: true } : {}),
        ...(model.capabilities?.includes('image-generation')
          ? { supportsImageGeneration: true }
          : {}),
      });
    }
  }
  return options;
}
