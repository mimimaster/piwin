import {
  lookupVideoGenerationRegistry,
  type ImageGenerationApiStyle,
  type ModelCapability,
  type ModelProviderConfig,
  type ModelRouteConfig,
  type VideoGenerationApiStyle,
} from '@piwin/contracts';
import {
  defaultVideoGenerationApiStyle,
  defaultVideoGenerationPath,
  isVideoApiStyle,
} from './video-generation-model-config.js';

export const IMAGE_API_STYLE_OPTIONS: readonly ImageGenerationApiStyle[] = [
  'openai',
  'imagen',
  'gemini',
];

export function isImageApiStyle(value: unknown): value is ImageGenerationApiStyle {
  return IMAGE_API_STYLE_OPTIONS.includes(value as ImageGenerationApiStyle);
}

export function imageApiStyleLabel(
  apiStyle: ImageGenerationApiStyle,
  locale: 'zh-CN' | 'en',
): string {
  switch (apiStyle) {
    case 'openai':
      return locale === 'zh-CN'
        ? 'OpenAI 格式 (images/generations)'
        : 'OpenAI format (images/generations)';
    case 'imagen':
      return locale === 'zh-CN' ? 'Imagen 格式 (:predict)' : 'Imagen format (:predict)';
    case 'gemini':
      return locale === 'zh-CN'
        ? 'Gemini 原生格式 (:generateContent)'
        : 'Gemini native format (:generateContent)';
  }
}

export type GenerationRouteDraftFields = {
  id: string;
  supportsImageGeneration: boolean;
  supportsVideoGeneration: boolean;
  imageApiStyle: ImageGenerationApiStyle | '';
  imagePath: string;
  imageTimeoutSeconds: string;
  videoApiStyle: VideoGenerationApiStyle | '';
  videoPath: string;
  videoTimeoutSeconds: string;
  videoPollIntervalSeconds: string;
};

export const EMPTY_GENERATION_ROUTE_FIELDS: Omit<
  GenerationRouteDraftFields,
  'id' | 'supportsImageGeneration' | 'supportsVideoGeneration'
> = {
  imageApiStyle: '',
  imagePath: '',
  imageTimeoutSeconds: '',
  videoApiStyle: '',
  videoPath: '',
  videoTimeoutSeconds: '',
  videoPollIntervalSeconds: '',
};

export function defaultImageApiStyle(
  protocol?: ModelProviderConfig['protocol'],
): ImageGenerationApiStyle {
  return protocol === 'google-gemini' ? 'imagen' : 'openai';
}

export function defaultImagePathForStyle(
  apiStyle: ImageGenerationApiStyle,
  modelId: string,
): string {
  switch (apiStyle) {
    case 'openai':
      return '/images/generations';
    case 'imagen':
      return `/models/${encodeURIComponent(modelId)}:predict`;
    case 'gemini':
      return `/models/${encodeURIComponent(modelId)}:generateContent`;
  }
}

export function suggestImageGenerationRoute(
  modelId: string,
  protocol?: ModelProviderConfig['protocol'],
  existing?: ModelRouteConfig,
): { apiStyle: ImageGenerationApiStyle; path: string } {
  const apiStyle = isImageApiStyle(existing?.apiStyle)
    ? existing.apiStyle
    : defaultImageApiStyle(protocol);
  const path = existing?.path?.trim() || defaultImagePathForStyle(apiStyle, modelId);
  return { apiStyle, path };
}

export function suggestVideoGenerationRoute(
  modelId: string,
  protocol?: ModelProviderConfig['protocol'],
  existing?: ModelRouteConfig,
): { apiStyle: VideoGenerationApiStyle; path: string } {
  const registry = lookupVideoGenerationRegistry(modelId, protocol);
  const apiStyle = isVideoApiStyle(existing?.apiStyle)
    ? existing.apiStyle
    : (registry?.entry.apiStyle ??
      defaultVideoGenerationApiStyle(protocol ?? 'openai-compatible'));
  const path =
    existing?.path?.trim() ||
    registry?.entry.path ||
    defaultVideoGenerationPath(apiStyle);
  return { apiStyle, path };
}

export function secondsFieldFromMs(value: number | undefined): string {
  if (value === undefined) return '';
  if (!Number.isFinite(value) || value <= 0) return '';
  return String(value / 1000);
}

export function msFromSecondsField(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return Math.round(parsed * 1000);
}

export function looksLikeAbsoluteUrl(value: string): boolean {
  return /^https?:\/\//i.test(value.trim());
}

export function normalizeRelativePath(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

export function buildImageGenerationRoute(
  draft: Pick<GenerationRouteDraftFields, 'imageApiStyle' | 'imagePath' | 'imageTimeoutSeconds'>,
): ModelRouteConfig | undefined {
  if (!isImageApiStyle(draft.imageApiStyle)) return undefined;
  const route: ModelRouteConfig = { apiStyle: draft.imageApiStyle };
  const path = normalizeRelativePath(draft.imagePath);
  if (path) route.path = path;
  const timeoutMs = msFromSecondsField(draft.imageTimeoutSeconds);
  if (timeoutMs !== undefined) route.timeoutMs = timeoutMs;
  return route;
}

export function buildVideoGenerationRoute(
  draft: Pick<
    GenerationRouteDraftFields,
    'videoApiStyle' | 'videoPath' | 'videoTimeoutSeconds' | 'videoPollIntervalSeconds'
  >,
): ModelRouteConfig | undefined {
  if (!isVideoApiStyle(draft.videoApiStyle)) return undefined;
  const route: ModelRouteConfig = { apiStyle: draft.videoApiStyle };
  const path = normalizeRelativePath(draft.videoPath);
  if (path) route.path = path;
  const timeoutMs = msFromSecondsField(draft.videoTimeoutSeconds);
  if (timeoutMs !== undefined) route.timeoutMs = timeoutMs;
  const pollIntervalMs = msFromSecondsField(draft.videoPollIntervalSeconds);
  if (pollIntervalMs !== undefined) route.pollIntervalMs = pollIntervalMs;
  return route;
}

export function hydrateGenerationRouteDraft(
  modelId: string,
  protocol: ModelProviderConfig['protocol'] | undefined,
  routes: Partial<Record<'image-generation' | 'video-generation', ModelRouteConfig>> | undefined,
  supportsImageGeneration: boolean,
  supportsVideoGeneration: boolean,
): Omit<GenerationRouteDraftFields, 'id' | 'supportsImageGeneration' | 'supportsVideoGeneration'> {
  const imageRoute = routes?.['image-generation'];
  const videoRoute = routes?.['video-generation'];
  const image =
    supportsImageGeneration || imageRoute
      ? suggestImageGenerationRoute(modelId, protocol, imageRoute)
      : undefined;
  const video =
    supportsVideoGeneration || videoRoute
      ? suggestVideoGenerationRoute(modelId, protocol, videoRoute)
      : undefined;
  return {
    imageApiStyle: image?.apiStyle ?? '',
    imagePath: image?.path ?? '',
    imageTimeoutSeconds: secondsFieldFromMs(imageRoute?.timeoutMs),
    videoApiStyle: video?.apiStyle ?? '',
    videoPath: video?.path ?? '',
    videoTimeoutSeconds: secondsFieldFromMs(videoRoute?.timeoutMs),
    videoPollIntervalSeconds: secondsFieldFromMs(videoRoute?.pollIntervalMs),
  };
}

export function withImageGenerationEnabled<T extends GenerationRouteDraftFields>(
  draft: T,
  enabled: boolean,
  protocol?: ModelProviderConfig['protocol'],
): T {
  if (!enabled) {
    return { ...draft, supportsImageGeneration: false };
  }
  if (isImageApiStyle(draft.imageApiStyle)) {
    return { ...draft, supportsImageGeneration: true };
  }
  const suggested = suggestImageGenerationRoute(draft.id, protocol);
  return {
    ...draft,
    supportsImageGeneration: true,
    imageApiStyle: suggested.apiStyle,
    imagePath: suggested.path,
  };
}

export function withVideoGenerationEnabled<T extends GenerationRouteDraftFields>(
  draft: T,
  enabled: boolean,
  protocol?: ModelProviderConfig['protocol'],
): T {
  if (!enabled) {
    return { ...draft, supportsVideoGeneration: false };
  }
  if (isVideoApiStyle(draft.videoApiStyle)) {
    return { ...draft, supportsVideoGeneration: true };
  }
  const suggested = suggestVideoGenerationRoute(draft.id, protocol);
  return {
    ...draft,
    supportsVideoGeneration: true,
    videoApiStyle: suggested.apiStyle,
    videoPath: suggested.path,
  };
}

export function withImageApiStyle<T extends GenerationRouteDraftFields>(
  draft: T,
  apiStyle: ImageGenerationApiStyle,
): T {
  const previousDefault = isImageApiStyle(draft.imageApiStyle)
    ? defaultImagePathForStyle(draft.imageApiStyle, draft.id)
    : '';
  const currentPath = draft.imagePath.trim();
  const nextPath =
    !currentPath || currentPath === previousDefault
      ? defaultImagePathForStyle(apiStyle, draft.id)
      : draft.imagePath;
  return { ...draft, imageApiStyle: apiStyle, imagePath: nextPath };
}

export function withVideoApiStyle<T extends GenerationRouteDraftFields>(
  draft: T,
  apiStyle: VideoGenerationApiStyle,
): T {
  const previousDefault = isVideoApiStyle(draft.videoApiStyle)
    ? defaultVideoGenerationPath(draft.videoApiStyle)
    : '';
  const currentPath = draft.videoPath.trim();
  const nextPath =
    !currentPath || currentPath === previousDefault
      ? defaultVideoGenerationPath(apiStyle)
      : draft.videoPath;
  return { ...draft, videoApiStyle: apiStyle, videoPath: nextPath };
}

/** Write one generation route onto an existing catalog row. Does not add or retag models. */
export function patchProviderModelRoute(
  providers: readonly ModelProviderConfig[],
  providerId: string,
  modelId: string,
  capability: Extract<ModelCapability, 'image-generation' | 'video-generation'>,
  route: ModelRouteConfig,
): ModelProviderConfig[] {
  return providers.map((provider) => {
    if (provider.id !== providerId) return provider;
    return {
      ...provider,
      models: provider.models.map((model) => {
        if (model.id !== modelId) return model;
        return {
          ...model,
          routes: {
            ...model.routes,
            [capability]: route,
          },
        };
      }),
    };
  });
}

export function fillMissingGenerationRoutes(
  modelId: string,
  capabilities: readonly string[] | undefined,
  routes: Partial<Record<'image-generation' | 'video-generation', ModelRouteConfig>> | undefined,
  protocol?: ModelProviderConfig['protocol'],
): Partial<Record<'image-generation' | 'video-generation', ModelRouteConfig>> | undefined {
  const next = { ...(routes ?? {}) };
  if (capabilities?.includes('image-generation') && next['image-generation'] === undefined) {
    const suggested = suggestImageGenerationRoute(modelId, protocol);
    next['image-generation'] = { apiStyle: suggested.apiStyle, path: suggested.path };
  }
  if (capabilities?.includes('video-generation') && next['video-generation'] === undefined) {
    const suggested = suggestVideoGenerationRoute(modelId, protocol);
    next['video-generation'] = { apiStyle: suggested.apiStyle, path: suggested.path };
  }
  return Object.keys(next).length > 0 ? next : undefined;
}
