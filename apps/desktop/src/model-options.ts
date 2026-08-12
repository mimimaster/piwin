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
  modelSupportsCapability,
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
