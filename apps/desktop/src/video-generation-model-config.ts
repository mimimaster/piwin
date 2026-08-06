import type {
  ModelConfigEntry,
  ModelProviderConfig,
  ModelRouteConfig,
  VideoGenerationApiStyle,
} from '@piwin/contracts';
import { normalizeRequestPath, parseTimeoutSeconds } from './ImageGenerationSettings';

export type VideoModelRow = {
  provider: ModelProviderConfig;
  model: ModelConfigEntry;
};

export const VIDEO_API_STYLE_OPTIONS: readonly VideoGenerationApiStyle[] = [
  'openai-videos',
  'google-veo',
  'runway-tasks',
  'luma-generations',
  'minimax-tasks',
  'custom',
];

/** Video-capable when it declares the capability or has a video route. */
export function isVideoGenerationModel(model: ModelConfigEntry): boolean {
  if (model.capabilities?.includes('video-generation')) {
    return true;
  }
  return model.routes?.['video-generation'] !== undefined;
}

export function collectVideoModels(providers: readonly ModelProviderConfig[]): VideoModelRow[] {
  const rows: VideoModelRow[] = [];
  for (const provider of providers) {
    for (const model of provider.models) {
      if (isVideoGenerationModel(model)) {
        rows.push({ provider, model });
      }
    }
  }
  return rows;
}

/** Pick the most likely adapter for a configured provider protocol. */
export function defaultVideoGenerationApiStyle(
  protocol: ModelProviderConfig['protocol'],
): VideoGenerationApiStyle {
  return protocol === 'google-gemini' ? 'google-veo' : 'openai-videos';
}

/** Default create-task path for each supported native adapter. */
export function defaultVideoGenerationPath(apiStyle: VideoGenerationApiStyle): string {
  switch (apiStyle) {
    case 'openai-videos':
      return '/videos';
    case 'google-veo':
      return '/models/{model}:predictLongRunning';
    case 'runway-tasks':
      return '/v1/text_to_video';
    case 'luma-generations':
      return '/dream-machine/v1/generations/video';
    case 'minimax-tasks':
      return '/v2/video_generation';
    case 'custom':
      return '/video/generations';
  }
}

function buildVideoRoute(input: {
  apiStyle: VideoGenerationApiStyle;
  path: string;
  timeoutSeconds: string;
  pollIntervalSeconds: string;
}): ModelRouteConfig {
  const normalizedPath = normalizeRequestPath(input.path);
  const timeoutSeconds = parseTimeoutSeconds(input.timeoutSeconds);
  const pollIntervalSeconds = parseTimeoutSeconds(input.pollIntervalSeconds);
  return {
    apiStyle: input.apiStyle,
    ...(normalizedPath ? { path: normalizedPath } : {}),
    ...(timeoutSeconds !== undefined ? { timeoutMs: timeoutSeconds * 1000 } : {}),
    ...(pollIntervalSeconds !== undefined ? { pollIntervalMs: pollIntervalSeconds * 1000 } : {}),
  };
}

export function buildVideoModelEntry(input: {
  id: string;
  apiStyle: VideoGenerationApiStyle;
  path: string;
  timeoutSeconds: string;
  pollIntervalSeconds: string;
  label: string;
  description: string;
}): ModelConfigEntry {
  const label = input.label.trim();
  const description = input.description.trim();
  return {
    id: input.id.trim(),
    capabilities: ['video-generation'],
    ...(label ? { label } : {}),
    ...(description ? { tooltipMarkdown: description } : {}),
    routes: {
      'video-generation': buildVideoRoute(input),
    },
  };
}

export function mergeVideoModel(
  existing: ModelConfigEntry,
  updated: ModelConfigEntry,
): ModelConfigEntry {
  const capabilities = new Set(existing.capabilities ?? []);
  capabilities.add('video-generation');
  const merged: ModelConfigEntry = {
    ...existing,
    id: updated.id,
    capabilities: [...capabilities],
    routes: {
      ...existing.routes,
      ...updated.routes,
    },
  };
  if (updated.label) {
    merged.label = updated.label;
  }
  if (updated.tooltipMarkdown) {
    merged.tooltipMarkdown = updated.tooltipMarkdown;
  }
  return merged;
}

export function videoApiStyleLabel(
  apiStyle: VideoGenerationApiStyle,
  locale: 'zh-CN' | 'en',
): string {
  const labels: Record<VideoGenerationApiStyle, string> = {
    'openai-videos': locale === 'zh-CN' ? 'OpenAI Videos / Sora' : 'OpenAI Videos / Sora',
    'google-veo': locale === 'zh-CN' ? 'Google Veo 长任务' : 'Google Veo long-running',
    'runway-tasks': locale === 'zh-CN' ? 'Runway Tasks' : 'Runway Tasks',
    'luma-generations': locale === 'zh-CN' ? 'Luma Generations' : 'Luma Generations',
    'minimax-tasks': locale === 'zh-CN' ? 'MiniMax Tasks' : 'MiniMax Tasks',
    custom: locale === 'zh-CN' ? '自定义异步任务' : 'Custom async task',
  };
  return labels[apiStyle];
}
