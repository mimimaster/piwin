import type { GeneratedVideo, VideoGenerationAdapterOptions } from './video-generation-types.js';
import { VideoGenConfigError } from './video-generation-types.js';
import {
  DEFAULT_VIDEO_TIMEOUT_MS,
  normalizeTimeout,
  resolveVideoApiStyle,
  resolveVideoEndpoint,
} from './video-generation-adapter-support.js';
import {
  generateGoogleVeoVideo,
  generateOpenAiVideo,
} from './video-generation-provider-openai-google.js';
import { generateLumaVideo, generateRunwayVideo } from './video-generation-provider-runway-luma.js';
import {
  generateCustomVideo,
  generateMiniMaxVideo,
} from './video-generation-provider-minimax-custom.js';

export { resolveVideoApiStyle, resolveVideoEndpoint } from './video-generation-adapter-support.js';

/** Generate and download one video using the model's configured wire format. */
export async function callVideoEndpoint(
  options: VideoGenerationAdapterOptions,
): Promise<GeneratedVideo> {
  const prompt = options.input.prompt.trim();
  if (!prompt) {
    throw new VideoGenConfigError('video_gen: prompt is required');
  }

  const route = options.model.routes?.['video-generation'];
  const timeoutMs = normalizeTimeout(route?.timeoutMs ?? DEFAULT_VIDEO_TIMEOUT_MS);
  const requestSignal = AbortSignal.any([options.signal, AbortSignal.timeout(timeoutMs)]);
  const fetchImpl = options.fetchImpl ?? fetch;
  const style = resolveVideoApiStyle(options.provider, options.model);
  const adapterOptions = { ...options, signal: requestSignal, fetchImpl };

  switch (style) {
    case 'openai-videos':
      return await generateOpenAiVideo(adapterOptions);
    case 'google-veo':
      return await generateGoogleVeoVideo(adapterOptions);
    case 'runway-tasks':
      return await generateRunwayVideo(adapterOptions);
    case 'luma-generations':
      return await generateLumaVideo(adapterOptions);
    case 'minimax-tasks':
      return await generateMiniMaxVideo(adapterOptions);
    case 'custom':
      return await generateCustomVideo(adapterOptions);
  }
}

// Keep these helpers reachable to adapter tests and future provider modules
// without making the support module part of the package public API.
export { resolvePollInterval } from './video-generation-adapter-support.js';
