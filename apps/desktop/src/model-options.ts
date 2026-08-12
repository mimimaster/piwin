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
 * Pure image-generation / video-generation models are excluded by default —
 * they live on dedicated settings pages and are not valid chat session models.
 * Models that also declare `chat` (or omit capabilities, which defaults to chat)
 * remain available.
 */
import {
  isModelEnabled,
  isProviderEnabled,
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
 * `capabilities` omit defaults to `['chat']` (contracts backward compat).
 * Pure image/video generation entries (no `chat`) are filtered out.
 */
export function isComposerChatModel(model: ModelConfigEntry): boolean {
  const capabilities = model.capabilities;
  if (!capabilities || capabilities.length === 0) {
    return true;
  }
  return capabilities.includes('chat');
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
