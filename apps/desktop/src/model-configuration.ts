import type {
  DiscoveredModel,
  ModelConfigEntry,
  ModelInputModality,
  ThinkingLevel,
} from '@piwin/contracts';

export type ModelConfigurationDraft = {
  id: string;
  label: string;
  contextWindow: string;
  maxOutputTokens: string;
  tooltipMarkdown: string;
  thinkingLevel: ThinkingLevel | '';
  /** Maps to `input` including `image`. */
  supportsImage: boolean;
  /** Maps to `reasoning`. */
  reasoning: boolean;
};

export function createModelConfigurationDraft(model: ModelConfigEntry): ModelConfigurationDraft {
  return {
    id: model.id,
    label: model.label ?? '',
    contextWindow: model.contextWindow === undefined ? '' : String(model.contextWindow),
    maxOutputTokens: model.maxOutputTokens === undefined ? '' : String(model.maxOutputTokens),
    tooltipMarkdown: model.tooltipMarkdown ?? '',
    thinkingLevel: model.thinkingLevel ?? '',
    supportsImage: model.input?.includes('image') ?? false,
    // Default true matches host registration when field is omitted.
    reasoning: model.reasoning ?? true,
  };
}

export function createModelConfigurationEntry(
  draft: ModelConfigurationDraft,
): ModelConfigEntry | null {
  const modelId = draft.id.trim();
  if (!modelId) {
    return null;
  }

  const contextWindow = parseOptionalPositiveInteger(draft.contextWindow);
  const maxOutputTokens = parseOptionalPositiveInteger(draft.maxOutputTokens);
  const model: ModelConfigEntry = { id: modelId };
  const label = draft.label.trim();
  const tooltipMarkdown = draft.tooltipMarkdown.trim();

  if (label && label !== modelId) {
    model.label = label;
  }
  if (contextWindow !== undefined) {
    model.contextWindow = contextWindow;
  }
  if (maxOutputTokens !== undefined) {
    model.maxOutputTokens = maxOutputTokens;
  }
  if (tooltipMarkdown) {
    model.tooltipMarkdown = tooltipMarkdown;
  }
  if (draft.thinkingLevel) {
    model.thinkingLevel = draft.thinkingLevel;
  }
  model.input = draft.supportsImage
    ? (['text', 'image'] as const satisfies readonly ModelInputModality[])
    : (['text'] as const satisfies readonly ModelInputModality[]);
  model.reasoning = draft.reasoning;
  return model;
}

/**
 * Apply an edited draft back onto a model list. Empty limit inputs remove the
 * corresponding fields so provider defaults apply again. Returns null when the
 * draft is invalid (blank model id) so callers can keep the editor open.
 */
export function applyModelConfigurationDraft(
  models: readonly ModelConfigEntry[],
  originalId: string,
  draft: ModelConfigurationDraft,
): ModelConfigEntry[] | null {
  const entry = createModelConfigurationEntry(draft);
  if (!entry) {
    return null;
  }
  return models.map((model) => (model.id === originalId ? entry : model));
}

export function mergeDiscoveredModels(
  configuredModels: readonly ModelConfigEntry[],
  selectedModels: readonly DiscoveredModel[],
): ModelConfigEntry[] {
  const modelsById = new Map(configuredModels.map((model) => [model.id, model]));
  for (const discoveredModel of selectedModels) {
    const modelId = discoveredModel.id.trim();
    if (!modelId || modelsById.has(modelId)) {
      continue;
    }
    const model: ModelConfigEntry = { id: modelId };
    if (discoveredModel.label?.trim() && discoveredModel.label !== modelId) {
      model.label = discoveredModel.label.trim();
    }
    if (discoveredModel.input) {
      model.input = discoveredModel.input;
    }
    if (discoveredModel.reasoning !== undefined) {
      model.reasoning = discoveredModel.reasoning;
    }
    if (discoveredModel.contextWindow !== undefined) {
      model.contextWindow = discoveredModel.contextWindow;
    }
    if (discoveredModel.maxOutputTokens !== undefined) {
      model.maxOutputTokens = discoveredModel.maxOutputTokens;
    }
    modelsById.set(modelId, model);
  }
  return [...modelsById.values()];
}

export function modelSupportsImage(model: Pick<ModelConfigEntry, 'input'> | undefined): boolean {
  return model?.input?.includes('image') ?? false;
}

function parseOptionalPositiveInteger(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}
