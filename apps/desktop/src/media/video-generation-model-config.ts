import type {
  ModelConfigEntry,
  ModelProviderConfig,
  VideoGenerationApiStyle,
} from '@piwin/contracts';

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
  'xgrok-videos',
  'custom',
];

/** Narrow a route apiStyle to the video wire formats (image styles excluded). */
export function isVideoApiStyle(value: unknown): value is VideoGenerationApiStyle {
  return (VIDEO_API_STYLE_OPTIONS as readonly unknown[]).includes(value);
}

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

/** Default create-task path for a video wire format. Host uses the same table. */
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
    case 'xgrok-videos':
      return '/videos/generations';
    case 'custom':
      return '/video/generations';
  }
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
    'xgrok-videos': locale === 'zh-CN' ? 'xGrok Videos' : 'xGrok Videos',
    custom: locale === 'zh-CN' ? '自定义异步任务' : 'Custom async task',
  };
  return labels[apiStyle];
}
