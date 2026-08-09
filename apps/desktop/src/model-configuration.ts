import {
  DEFAULT_MODEL_CONTEXT_WINDOW,
  DEFAULT_MODEL_MAX_OUTPUT_TOKENS,
  THINKING_LEVEL_OPTIONS,
} from '@piwin/contracts';
import type {
  DiscoveredModel,
  ModelCapability,
  ModelCatalogEntry,
  ModelConfigEntry,
  ModelInputModality,
  ModelProviderConfig,
  ThinkingLevel,
} from '@piwin/contracts';
import { getDefaultThinkingLevelsForProtocol } from './model-thinking-policy.js';

export type ModelConfigurationDraft = {
  id: string;
  label: string;
  contextWindow: string;
  maxOutputTokens: string;
  tooltipMarkdown: string;
  thinkingLevel: ThinkingLevel | '';
  thinkingLevels: ThinkingLevel[];
  /** Maps to `input` including `image`. */
  supportsImage: boolean;
  /** Maps to `capabilities` including `image-generation`. */
  supportsImageGeneration: boolean;
  /** Maps to `capabilities` including `speech-to-text`. */
  supportsSpeechToText: boolean;
  /** Maps to `capabilities` including `text-to-speech`. */
  supportsTextToSpeech: boolean;
  /** Maps to `reasoning`. */
  reasoning: boolean;
};

export function mergeModelCatalogDefaults(
  model: ModelConfigEntry,
  catalog: ModelCatalogEntry | undefined,
): ModelConfigEntry {
  if (!catalog) return { ...model };
  return {
    ...model,
    ...(model.label === undefined && catalog.name !== model.id ? { label: catalog.name } : {}),
    ...(model.contextWindow === undefined ? { contextWindow: catalog.contextWindow } : {}),
    ...(model.maxOutputTokens === undefined ? { maxOutputTokens: catalog.maxTokens } : {}),
    ...(model.input === undefined ? { input: catalog.input } : {}),
    ...(model.reasoning === undefined ? { reasoning: catalog.reasoning } : {}),
  };
}

export function createModelConfigurationDraft(
  model: ModelConfigEntry,
  catalog?: ModelCatalogEntry,
  protocol?: ModelProviderConfig['protocol'],
): ModelConfigurationDraft {
  const effective = mergeModelCatalogDefaults(model, catalog);
  const configuredThinkingLevels = effective.thinkingLevels ?? [];
  const protocolDefaults =
    configuredThinkingLevels.length === 0 ? getDefaultThinkingLevelsForProtocol(protocol) : [];
  const thinkingLevels = [...configuredThinkingLevels, ...protocolDefaults].filter(
    (level, index, values) =>
      THINKING_LEVEL_OPTIONS.includes(level) && values.indexOf(level) === index,
  );

  return {
    id: effective.id,
    label: effective.label ?? '',
    contextWindow: String(effective.contextWindow ?? DEFAULT_MODEL_CONTEXT_WINDOW),
    maxOutputTokens: String(effective.maxOutputTokens ?? DEFAULT_MODEL_MAX_OUTPUT_TOKENS),
    tooltipMarkdown: effective.tooltipMarkdown ?? '',
    thinkingLevel:
      effective.thinkingLevel && thinkingLevels.includes(effective.thinkingLevel)
        ? effective.thinkingLevel
        : '',
    thinkingLevels,
    supportsImage: effective.input?.includes('image') ?? false,
    supportsImageGeneration: effective.capabilities?.includes('image-generation') ?? false,
    supportsSpeechToText: effective.capabilities?.includes('speech-to-text') ?? false,
    supportsTextToSpeech: effective.capabilities?.includes('text-to-speech') ?? false,
    reasoning: effective.reasoning ?? true,
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
  if (draft.thinkingLevels.length > 0) {
    model.thinkingLevels = draft.thinkingLevels;
    if (draft.thinkingLevel && draft.thinkingLevels.includes(draft.thinkingLevel)) {
      model.thinkingLevel = draft.thinkingLevel;
    }
  }
  model.input = draft.supportsImage
    ? (['text', 'image'] as const satisfies readonly ModelInputModality[])
    : (['text'] as const satisfies readonly ModelInputModality[]);
  model.reasoning = draft.reasoning;
  const capabilities: ModelCapability[] = [];
  if (draft.supportsImageGeneration) {
    capabilities.push('image-generation');
  }
  if (draft.supportsSpeechToText) {
    capabilities.push('speech-to-text');
  }
  if (draft.supportsTextToSpeech) {
    capabilities.push('text-to-speech');
  }
  if (capabilities.length > 0) {
    model.capabilities = capabilities;
  }
  return model;
}

export function validateModelConfigurationDraft(draft: ModelConfigurationDraft): string | null {
  if (!draft.id.trim()) return 'Model ID is required.';
  for (const [label, value] of [
    ['context window', draft.contextWindow],
    ['max output tokens', draft.maxOutputTokens],
  ] as const) {
    if (!value.trim()) continue;
    const parsed = Number(value.trim());
    if (!Number.isSafeInteger(parsed) || parsed <= 0) {
      return `${label} must be a positive integer.`;
    }
  }
  if (draft.thinkingLevel && !draft.thinkingLevels.includes(draft.thinkingLevel)) {
    return 'The default thinking effort must be one of the supported levels.';
  }
  if (draft.thinkingLevels.some((level) => !THINKING_LEVEL_OPTIONS.includes(level))) {
    return 'Thinking levels contain an unsupported value.';
  }
  return null;
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
  const original = models.find((model) => model.id === originalId);
  if (!original) return [...models];
  const entry = createModelConfigurationEntry(draft);
  if (!entry) {
    return null;
  }
  const updated: ModelConfigEntry = { ...original, ...entry };
  // Preserve the `enabled` flag from the original — the inline editor
  // does not manage this field; it is toggled via the row switch.
  if (original.enabled !== undefined) {
    updated.enabled = original.enabled;
  }
  if (!draft.contextWindow.trim()) delete updated.contextWindow;
  if (!draft.maxOutputTokens.trim()) delete updated.maxOutputTokens;
  if (!draft.label.trim() || draft.label.trim() === updated.id) delete updated.label;
  if (!draft.tooltipMarkdown.trim()) delete updated.tooltipMarkdown;
  // Preserve capability tags that this editor does not expose (for example
  // video-generation), while replacing the image and speech flags it owns.
  const preservedCapabilities = (original.capabilities ?? []).filter(
    (capability) =>
      capability !== 'image-generation' &&
      capability !== 'speech-to-text' &&
      capability !== 'text-to-speech',
  );
  const editedCapabilities = new Set<ModelCapability>(preservedCapabilities);
  if (draft.supportsImageGeneration) editedCapabilities.add('image-generation');
  if (draft.supportsSpeechToText) editedCapabilities.add('speech-to-text');
  if (draft.supportsTextToSpeech) editedCapabilities.add('text-to-speech');
  if (editedCapabilities.size > 0) {
    updated.capabilities = [...editedCapabilities];
  } else {
    delete updated.capabilities;
  }
  if (draft.thinkingLevels.length === 0) {
    delete updated.thinkingLevels;
    delete updated.thinkingLevel;
  }
  return models.map((model) => (model.id === originalId ? updated : model));
}

export function mergeDiscoveredModels(
  configuredModels: readonly ModelConfigEntry[],
  selectedModels: readonly DiscoveredModel[],
): ModelConfigEntry[] {
  const modelsById = new Map(configuredModels.map((model) => [model.id, model]));
  for (const discoveredModel of selectedModels) {
    const modelId = discoveredModel.id.trim();
    if (!modelId) {
      continue;
    }
    const existing = modelsById.get(modelId);
    // Re-import is intentional: fill missing fields from discovery/catalog.
    // Never overwrite values the user (or a prior import) already set.
    modelsById.set(modelId, mergeDiscoveredModelEntry(existing, discoveredModel, modelId));
  }
  return [...modelsById.values()];
}

/**
 * Build or enrich one configured model from a discovered row.
 * Existing fields win; discovery only fills gaps.
 */
function mergeDiscoveredModelEntry(
  existing: ModelConfigEntry | undefined,
  discoveredModel: DiscoveredModel,
  modelId: string,
): ModelConfigEntry {
  const model: ModelConfigEntry = existing ? { ...existing, id: modelId } : { id: modelId };
  const discoveredLabel = discoveredModel.label?.trim();
  if (!model.label?.trim() && discoveredLabel && discoveredLabel !== modelId) {
    model.label = discoveredLabel;
  }
  // Capabilities from discovery are authoritative hints (e.g. host auto-tags
  // known Pi image models). Union them in so re-import never drops a tag the
  // user or a previous import already set.
  if (discoveredModel.capabilities?.length) {
    const capabilities = new Set(model.capabilities ?? []);
    for (const capability of discoveredModel.capabilities) {
      capabilities.add(capability);
    }
    model.capabilities = [...capabilities];
  }
  if (model.input === undefined && discoveredModel.input) {
    model.input = discoveredModel.input;
  }
  if (model.reasoning === undefined && discoveredModel.reasoning !== undefined) {
    model.reasoning = discoveredModel.reasoning;
  }
  if (model.contextWindow === undefined && discoveredModel.contextWindow !== undefined) {
    model.contextWindow = discoveredModel.contextWindow;
  }
  if (model.maxOutputTokens === undefined && discoveredModel.maxOutputTokens !== undefined) {
    model.maxOutputTokens = discoveredModel.maxOutputTokens;
  }
  return model;
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
