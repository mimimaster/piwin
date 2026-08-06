/**
 * Builds the flat, enabled model option list used by the composer and the
 * sub-agent profile pickers.
 *
 * Both the provider and the model must be enabled (contracts' isProviderEnabled
 * / isModelEnabled). A disabled provider never reaches the host's ModelRuntime
 * (the host only registers providers from getEnabledProviders), so listing its
 * models here would let the user pick a model the session layer then rejects
 * with "Configured model is unavailable: <providerId>/<modelId>".
 */
import {
  isModelEnabled,
  isProviderEnabled,
  type ModelProviderConfig,
  type ThinkingLevel,
} from '@piwin/contracts';

export type ModelOption = {
  providerId: string;
  protocol: ModelProviderConfig['protocol'];
  modelId: string;
  label: string;
  contextWindow?: number;
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
      options.push({
        providerId: provider.id,
        protocol: provider.protocol,
        modelId: model.id,
        label: `${provider.name} / ${model.label ?? model.id}`,
        ...(typeof model.contextWindow === 'number' ? { contextWindow: model.contextWindow } : {}),
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
