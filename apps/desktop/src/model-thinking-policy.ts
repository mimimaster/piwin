import { THINKING_LEVEL_OPTIONS } from '@piwin/contracts';
import type { ModelProviderConfig, ThinkingLevel } from '@piwin/contracts';

export type ThinkingModelFields = {
  reasoning?: boolean;
  thinkingLevels?: readonly ThinkingLevel[];
  thinkingLevel?: ThinkingLevel;
  protocol?: ModelProviderConfig['protocol'] | undefined;
};

/** Protocol-based default thinking levels when a model has no explicit config. */
export const DEFAULT_THINKING_LEVELS_BY_PROTOCOL: Record<
  ModelProviderConfig['protocol'],
  readonly ThinkingLevel[]
> = {
  'openai-compatible': ['low', 'medium', 'high', 'xhigh'],
  'anthropic-compatible': ['low', 'medium', 'high', 'max'],
  'google-gemini': ['low', 'medium', 'high'],
};

export function getDefaultThinkingLevelsForProtocol(
  protocol: ModelProviderConfig['protocol'] | undefined,
): readonly ThinkingLevel[] {
  if (!protocol) return [];
  return DEFAULT_THINKING_LEVELS_BY_PROTOCOL[protocol] ?? [];
}

export function getSupportedThinkingLevels(
  model: ThinkingModelFields | undefined,
  _ultraEnabled: boolean,
): ThinkingLevel[] {
  if (!model || model.reasoning !== true) return [];
  const baseLevels =
    model.thinkingLevels && model.thinkingLevels.length > 0
      ? model.thinkingLevels
      : getDefaultThinkingLevelsForProtocol(model.protocol);
  // ultra is not offered anymore; THINKING_LEVEL_OPTIONS no longer contains
  // it, so this filter is defense-in-depth only.
  return baseLevels.filter(
    (level, index, levels) =>
      THINKING_LEVEL_OPTIONS.includes(level) && levels.indexOf(level) === index && level !== 'ultra',
  );
}

export function resolveThinkingLevelForModel(
  model: ThinkingModelFields | undefined,
  requested: ThinkingLevel,
  ultraEnabled: boolean,
): ThinkingLevel | undefined {
  const levels = getSupportedThinkingLevels(model, ultraEnabled);
  if (levels.length === 0) return undefined;
  if (levels.includes(requested)) return requested;
  if (model?.thinkingLevel && levels.includes(model.thinkingLevel)) return model.thinkingLevel;
  return levels[0];
}

export function canUseThinkingLevel(
  model: ThinkingModelFields | undefined,
  level: ThinkingLevel,
  ultraEnabled: boolean,
): boolean {
  return getSupportedThinkingLevels(model, ultraEnabled).includes(level);
}
