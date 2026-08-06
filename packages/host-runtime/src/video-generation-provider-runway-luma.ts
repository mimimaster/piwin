import type {
  GeneratedVideo,
  JsonRecord,
  VideoGenerationAdapterOptions,
} from './video-generation-types.js';
import { VideoGenConfigError } from './video-generation-types.js';
import {
  bearerHeaders,
  delay,
  downloadVideo,
  extractRunwayOutputUrl,
  fetchJson,
  normalizeLumaDuration,
  normalizeRunwayDuration,
  normalizeRunwayRatio,
  normalizeStatus,
  readNestedString,
  readString,
  requireTaskId,
  resolvePollInterval,
  resolveVideoEndpoint,
  throwIfFailed,
  toDataUrl,
} from './video-generation-adapter-support.js';

export async function generateRunwayVideo(
  options: VideoGenerationAdapterOptions & { signal: AbortSignal; fetchImpl: typeof fetch },
): Promise<GeneratedVideo> {
  let endpoint = resolveVideoEndpoint(options.provider, options.model, 'runway-tasks');
  const inputImage = options.input.inputImage;
  if (inputImage && /\/text_to_video(?:$|\?)/.test(endpoint)) {
    endpoint = endpoint.replace(/\/text_to_video(?=$|\?)/, '/image_to_video');
  }

  const body: JsonRecord = {
    model: options.model.id,
    promptText: options.input.prompt.trim(),
    ratio: normalizeRunwayRatio(options.input.aspectRatio),
    duration: normalizeRunwayDuration(options.input.durationSeconds),
  };
  if (inputImage) body.promptImage = toDataUrl(inputImage);

  const headers = {
    ...bearerHeaders(options.provider, options.apiKey),
    'content-type': 'application/json',
    'X-Runway-Version': '2024-11-06',
  };
  let task = await fetchJson(options.fetchImpl, endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: options.signal,
  });
  const taskId = requireTaskId(task, 'Runway');
  const taskEndpoint = `${endpoint.slice(0, endpoint.lastIndexOf('/'))}/tasks/${encodeURIComponent(taskId)}`;

  while (true) {
    const status = normalizeStatus(readString(task, 'status'));
    if (status === 'succeeded' || status === 'completed') {
      const outputUrl = extractRunwayOutputUrl(task);
      if (!outputUrl) throw new VideoGenConfigError('video_gen: Runway returned no output URL');
      const video = await downloadVideo(options.fetchImpl, outputUrl, headers, options.signal);
      return { ...video, providerTaskId: taskId };
    }
    throwIfFailed(status, task, 'Runway');
    await delay(resolvePollInterval(options.model), options.signal);
    task = await fetchJson(options.fetchImpl, taskEndpoint, {
      method: 'GET',
      headers,
      signal: options.signal,
    });
  }
}

export async function generateLumaVideo(
  options: VideoGenerationAdapterOptions & { signal: AbortSignal; fetchImpl: typeof fetch },
): Promise<GeneratedVideo> {
  const endpoint = resolveVideoEndpoint(options.provider, options.model, 'luma-generations');
  const body: JsonRecord = {
    generation_type: 'video',
    model: options.model.id,
    prompt: options.input.prompt.trim(),
    aspect_ratio: options.input.aspectRatio ?? '16:9',
  };
  if (options.input.durationSeconds !== undefined) {
    body.duration = normalizeLumaDuration(options.input.durationSeconds);
  }
  if (options.input.resolution) body.resolution = options.input.resolution;
  if (options.input.inputImage) {
    body.keyframes = {
      frame0: { type: 'image', url: toDataUrl(options.input.inputImage) },
    };
  }

  const headers = {
    ...bearerHeaders(options.provider, options.apiKey),
    'content-type': 'application/json',
  };
  let generation = await fetchJson(options.fetchImpl, endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: options.signal,
  });
  const generationId = requireTaskId(generation, 'Luma');
  const generationEndpoint = `${endpoint.replace(/\/video$/, '')}/${encodeURIComponent(generationId)}`;

  while (true) {
    const status = normalizeStatus(
      readString(generation, 'state') ?? readString(generation, 'status'),
    );
    if (status === 'completed' || status === 'succeeded') {
      const videoUrl = readNestedString(generation, ['assets', 'video']);
      if (!videoUrl) throw new VideoGenConfigError('video_gen: Luma returned no video URL');
      const video = await downloadVideo(options.fetchImpl, videoUrl, headers, options.signal);
      return { ...video, providerTaskId: generationId };
    }
    throwIfFailed(status, generation, 'Luma');
    await delay(resolvePollInterval(options.model), options.signal);
    generation = await fetchJson(options.fetchImpl, generationEndpoint, {
      method: 'GET',
      headers,
      signal: options.signal,
    });
  }
}
