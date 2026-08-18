import {
  DEFAULT_MODEL_CONTEXT_WINDOW,
  DEFAULT_MODEL_MAX_OUTPUT_TOKENS,
  isLikelyImageGenerationModel,
  isLikelyVideoGenerationModel,
  modelSupportsCapability,
  THINKING_LEVEL_OPTIONS,
} from '@piwin/contracts';
import type {
  DiscoveredModel,
  ImageGenerationApiStyle,
  ModelCapability,
  ModelCatalogEntry,
  ModelConfigEntry,
  ModelInputModality,
  ModelProviderConfig,
  ModelRouteConfig,
  ThinkingLevel,
  VideoGenerationApiStyle,
} from '@piwin/contracts';
import {
  buildImageGenerationRoute,
  buildVideoGenerationRoute,
  fillMissingGenerationRoutes,
  hydrateGenerationRouteDraft,
  isImageApiStyle,
  looksLikeAbsoluteUrl,
} from './generation-route-defaults.js';
import { getDefaultThinkingLevelsForProtocol } from './model-thinking-policy.js';
import { isVideoApiStyle } from './video-generation-model-config.js';

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
  /** Maps to `capabilities` including `video-generation`. */
  supportsVideoGeneration: boolean;
  /** Maps to `capabilities` including `speech-to-text`. */
  supportsSpeechToText: boolean;
  /** Maps to `capabilities` including `text-to-speech`. */
  supportsTextToSpeech: boolean;
  /** Maps to `capabilities` including `native-web-search`. */
  supportsNativeWebSearch: boolean;
  /** Maps to `reasoning`. */
  reasoning: boolean;
  imageApiStyle: ImageGenerationApiStyle | '';
  imagePath: string;
  imageTimeoutSeconds: string;
  videoApiStyle: VideoGenerationApiStyle | '';
  videoPath: string;
  videoTimeoutSeconds: string;
  videoPollIntervalSeconds: string;
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
  const likelyImage =
    effective.capabilities?.includes('image-generation') === true ||
    isLikelyImageGenerationModel(effective.id, effective.label, effective.capabilities);
  const likelyVideo =
    effective.capabilities?.includes('video-generation') === true ||
    isLikelyVideoGenerationModel(effective.id, effective.label, effective.capabilities);
  // Generation-only ids (grok-imagine-image-lite, sora, …) must not inherit the
  // chat-model defaults: reasoning on, protocol thinking chips, 对话-shaped limits.
  const generationOnly =
    (likelyImage || likelyVideo) && effective.capabilities?.includes('chat') !== true;
  const configuredThinkingLevels = effective.thinkingLevels ?? [];
  const protocolDefaults =
    !generationOnly && configuredThinkingLevels.length === 0
      ? getDefaultThinkingLevelsForProtocol(protocol)
      : [];
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
    supportsImageGeneration: likelyImage,
    supportsVideoGeneration: likelyVideo,
    supportsSpeechToText: effective.capabilities?.includes('speech-to-text') ?? false,
    supportsTextToSpeech: effective.capabilities?.includes('text-to-speech') ?? false,
    supportsNativeWebSearch: modelSupportsCapability(effective, 'native-web-search'),
    reasoning: generationOnly ? effective.reasoning === true : (effective.reasoning ?? true),
    ...hydrateGenerationRouteDraft(
      effective.id,
      protocol,
      effective.routes,
      likelyImage,
      likelyVideo,
    ),
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
  if (draft.supportsVideoGeneration) {
    capabilities.push('video-generation');
  }
  if (draft.supportsSpeechToText) {
    capabilities.push('speech-to-text');
  }
  if (draft.supportsTextToSpeech) {
    capabilities.push('text-to-speech');
  }
  if (draft.supportsNativeWebSearch) {
    capabilities.push('native-web-search');
  }
  if (capabilities.length > 0) {
    model.capabilities = capabilities;
  }
  const routes: Partial<Record<ModelCapability, ModelRouteConfig>> = {};
  const imageRoute = draft.supportsImageGeneration ? buildImageGenerationRoute(draft) : undefined;
  const videoRoute = draft.supportsVideoGeneration ? buildVideoGenerationRoute(draft) : undefined;
  if (imageRoute) routes['image-generation'] = imageRoute;
  if (videoRoute) routes['video-generation'] = videoRoute;
  if (Object.keys(routes).length > 0) {
    model.routes = routes;
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
  if (draft.supportsImageGeneration) {
    if (!isImageApiStyle(draft.imageApiStyle)) {
      return 'Image generation requires an API style.';
    }
    if (looksLikeAbsoluteUrl(draft.imagePath)) {
      return 'Image generation path must be relative to the provider base URL.';
    }
  }
  if (draft.supportsVideoGeneration) {
    if (!isVideoApiStyle(draft.videoApiStyle)) {
      return 'Video generation requires an API style.';
    }
    if (looksLikeAbsoluteUrl(draft.videoPath)) {
      return 'Video generation path must be relative to the provider base URL.';
    }
  }
  for (const [label, value] of [
    ['image timeout', draft.imageTimeoutSeconds],
    ['video timeout', draft.videoTimeoutSeconds],
    ['video poll interval', draft.videoPollIntervalSeconds],
  ] as const) {
    if (!value.trim()) continue;
    const parsed = Number(value.trim());
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return `${label} must be a positive number of seconds.`;
    }
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
  // Preserve capability tags that this editor does not expose while replacing
  // the generation, speech, and native-search flags it owns.
  const preservedCapabilities = (original.capabilities ?? []).filter(
    (capability) =>
      capability !== 'image-generation' &&
      capability !== 'video-generation' &&
      capability !== 'speech-to-text' &&
      capability !== 'text-to-speech' &&
      capability !== 'native-web-search',
  );
  const editedCapabilities = new Set<ModelCapability>(preservedCapabilities);
  if (draft.supportsImageGeneration) editedCapabilities.add('image-generation');
  if (draft.supportsVideoGeneration) editedCapabilities.add('video-generation');
  if (draft.supportsSpeechToText) editedCapabilities.add('speech-to-text');
  if (draft.supportsTextToSpeech) editedCapabilities.add('text-to-speech');
  if (draft.supportsNativeWebSearch) editedCapabilities.add('native-web-search');
  if (editedCapabilities.size > 0) {
    updated.capabilities = [...editedCapabilities];
  } else {
    delete updated.capabilities;
  }
  const legacyUpdated = updated as ModelConfigEntry & { nativeWebSearchMode?: unknown };
  delete legacyUpdated.nativeWebSearchMode;
  if (draft.thinkingLevels.length === 0) {
    delete updated.thinkingLevels;
    delete updated.thinkingLevel;
  }
  const nextRoutes = { ...(original.routes ?? {}) };
  delete nextRoutes['native-web-search'];
  if (draft.supportsImageGeneration && entry.routes?.['image-generation']) {
    nextRoutes['image-generation'] = entry.routes['image-generation'];
  } else {
    delete nextRoutes['image-generation'];
  }
  if (draft.supportsVideoGeneration && entry.routes?.['video-generation']) {
    nextRoutes['video-generation'] = entry.routes['video-generation'];
  } else {
    delete nextRoutes['video-generation'];
  }
  if (!draft.supportsSpeechToText) delete nextRoutes['speech-to-text'];
  if (!draft.supportsTextToSpeech) delete nextRoutes['text-to-speech'];
  if (Object.keys(nextRoutes).length > 0) {
    updated.routes = nextRoutes;
  } else {
    delete updated.routes;
  }
  return models.map((model) => (model.id === originalId ? updated : model));
}

export function mergeDiscoveredModels(
  configuredModels: readonly ModelConfigEntry[],
  selectedModels: readonly DiscoveredModel[],
  protocol?: ModelProviderConfig['protocol'],
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
    modelsById.set(
      modelId,
      mergeDiscoveredModelEntry(existing, discoveredModel, modelId, protocol),
    );
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
  protocol?: ModelProviderConfig['protocol'],
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
  const suggestion = discoveredModel.videoGenerationSuggestion;
  if (model.routes?.['video-generation'] === undefined && suggestion) {
    const suggestedRoute: ModelRouteConfig = {};
    if (isVideoApiStyle(suggestion.apiStyle)) {
      suggestedRoute.apiStyle = suggestion.apiStyle;
    }
    const suggestedPath = suggestion.path?.trim();
    if (suggestedPath) {
      suggestedRoute.path = suggestedPath;
    }
    if (Object.keys(suggestedRoute).length > 0) {
      model.routes = { ...model.routes, 'video-generation': suggestedRoute };
    }
  }
  const generationRoutes = fillMissingGenerationRoutes(
    modelId,
    model.capabilities,
    {
      ...(model.routes?.['image-generation']
        ? { 'image-generation': model.routes['image-generation'] }
        : {}),
      ...(model.routes?.['video-generation']
        ? { 'video-generation': model.routes['video-generation'] }
        : {}),
    },
    protocol,
  );
  if (generationRoutes) {
    model.routes = { ...model.routes, ...generationRoutes };
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
