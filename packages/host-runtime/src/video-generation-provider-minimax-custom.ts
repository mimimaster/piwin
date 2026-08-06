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
  fetchJson,
  normalizeStatus,
  readNestedString,
  readRecord,
  readString,
  requireTaskId,
  resolveDownloadUrl,
  resolvePollInterval,
  resolveVideoEndpoint,
  throwIfFailed,
  toDataUrl,
} from './video-generation-adapter-support.js';

export async function generateMiniMaxVideo(
  options: VideoGenerationAdapterOptions & { signal: AbortSignal; fetchImpl: typeof fetch },
): Promise<GeneratedVideo> {
  const endpoint = resolveVideoEndpoint(options.provider, options.model, 'minimax-tasks');
  const content: JsonRecord[] = [{ type: 'text', text: options.input.prompt.trim() }];
  if (options.input.inputImage) {
    content.push({
      type: 'image_url',
      image_url: { url: toDataUrl(options.input.inputImage) },
      role: 'first_frame',
    });
  }
  const body: JsonRecord = {
    model: options.model.id,
    content,
    duration: Math.max(4, Math.min(15, Math.floor(options.input.durationSeconds ?? 5))),
    resolution: options.input.resolution ?? '768P',
  };
  if (!options.input.inputImage) body.ratio = options.input.aspectRatio ?? '16:9';

  const headers = {
    ...bearerHeaders(options.provider, options.apiKey),
    'content-type': 'application/json',
  };
  const created = await fetchJson(options.fetchImpl, endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: options.signal,
  });
  const taskId = readString(created, 'task_id') ?? readNestedString(created, ['task', 'task_id']);
  if (!taskId) throw new VideoGenConfigError('video_gen: MiniMax returned no task_id');
  const queryEndpoint = `${endpoint.replace(/\/video_generation$/, '')}/query/video_generation/${encodeURIComponent(taskId)}`;

  while (true) {
    await delay(resolvePollInterval(options.model), options.signal);
    const taskResponse = await fetchJson(options.fetchImpl, queryEndpoint, {
      method: 'GET',
      headers,
      signal: options.signal,
    });
    const task = readRecord(taskResponse, 'task') ?? taskResponse;
    const status = normalizeStatus(readString(task, 'status'));
    if (status === 'succeeded' || status === 'completed' || status === 'success') {
      const videoUrl = readNestedString(task, ['content', 'url']);
      if (!videoUrl) throw new VideoGenConfigError('video_gen: MiniMax returned no video URL');
      const video = await downloadVideo(options.fetchImpl, videoUrl, headers, options.signal);
      return { ...video, providerTaskId: taskId };
    }
    throwIfFailed(status, task, 'MiniMax');
  }
}

/**
 * Convention-based fallback for smaller providers: POST creates `{id}`, GET
 * on `/create-path/{id}` returns a terminal status and `video_url`, `url`, or
 * `output.url`. Native adapters remain preferred because they validate each
 * vendor's exact request and response shape.
 */
export async function generateCustomVideo(
  options: VideoGenerationAdapterOptions & { signal: AbortSignal; fetchImpl: typeof fetch },
): Promise<GeneratedVideo> {
  const endpoint = resolveVideoEndpoint(options.provider, options.model, 'custom');
  const body: JsonRecord = {
    model: options.model.id,
    prompt: options.input.prompt.trim(),
  };
  if (options.input.durationSeconds !== undefined)
    body.durationSeconds = options.input.durationSeconds;
  if (options.input.aspectRatio) body.aspectRatio = options.input.aspectRatio;
  if (options.input.size) body.size = options.input.size;
  if (options.input.resolution) body.resolution = options.input.resolution;
  if (options.input.inputImage) body.inputImage = toDataUrl(options.input.inputImage);

  const headers = {
    ...bearerHeaders(options.provider, options.apiKey),
    'content-type': 'application/json',
  };
  let task = await fetchJson(options.fetchImpl, endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: options.signal,
  });
  const taskId = requireTaskId(task, 'custom video provider');
  const taskEndpoint = `${endpoint}/${encodeURIComponent(taskId)}`;

  while (true) {
    const status = normalizeStatus(readString(task, 'status'));
    if (status === 'completed' || status === 'succeeded' || status === 'success') {
      const outputUrl =
        readString(task, 'video_url') ??
        readString(task, 'url') ??
        readNestedString(task, ['output', 'url']) ??
        readNestedString(task, ['video', 'url']) ??
        readNestedString(task, ['content', 'url']);
      if (!outputUrl) {
        throw new VideoGenConfigError(
          'video_gen: custom provider completed without video_url, url, output.url, or content.url',
        );
      }
      const video = await downloadVideo(
        options.fetchImpl,
        resolveDownloadUrl(outputUrl, options.provider.baseUrl),
        headers,
        options.signal,
      );
      return { ...video, providerTaskId: taskId };
    }
    throwIfFailed(status, task, 'custom video provider');
    await delay(resolvePollInterval(options.model), options.signal);
    task = await fetchJson(options.fetchImpl, taskEndpoint, {
      method: 'GET',
      headers,
      signal: options.signal,
    });
  }
}
