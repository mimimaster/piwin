import type { ConfiguredChatModel, ConfiguredChatModelsData } from '@piwin/contracts';
import { isThinkingLevel } from '@piwin/contracts';

export function projectConfiguredChatModelsResponse(data: unknown): ConfiguredChatModelsData {
  const record = asRecord(data);
  const models: ConfiguredChatModel[] = [];
  const rawModels = record?.models;
  if (Array.isArray(rawModels)) {
    for (const item of rawModels) {
      const model = asRecord(item);
      if (
        model === undefined ||
        typeof model.providerId !== 'string' ||
        typeof model.modelId !== 'string' ||
        (model.protocol !== 'openai-compatible' &&
          model.protocol !== 'anthropic-compatible' &&
          model.protocol !== 'google-gemini')
      ) {
        continue;
      }
      const projected: ConfiguredChatModel = {
        providerId: model.providerId,
        protocol: model.protocol,
        modelId: model.modelId,
      };
      if (typeof model.label === 'string' && model.label.length > 0) {
        projected.label = model.label;
      }
      if (isThinkingLevel(model.thinkingLevel)) {
        projected.thinkingLevel = model.thinkingLevel;
      }
      if (Array.isArray(model.thinkingLevels)) {
        const thinkingLevels = model.thinkingLevels.filter(isThinkingLevel);
        if (thinkingLevels.length > 0) {
          projected.thinkingLevels = thinkingLevels;
        }
      }
      if (typeof model.reasoning === 'boolean') {
        projected.reasoning = model.reasoning;
      }
      models.push(projected);
    }
  }
  const projected: ConfiguredChatModelsData = { models };
  if (typeof record?.defaultProviderId === 'string' && record.defaultProviderId.length > 0) {
    projected.defaultProviderId = record.defaultProviderId;
  }
  if (typeof record?.defaultModelId === 'string' && record.defaultModelId.length > 0) {
    projected.defaultModelId = record.defaultModelId;
  }
  return projected;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : undefined;
}
