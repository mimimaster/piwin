import type {
  GeneratedVideo,
  JsonRecord,
  VideoGenerationAdapterOptions,
} from './video-generation-types.js';
import {
  bearerHeaders,
  bytesToBase64,
  delay,
  downloadVideo,
  fetchJson,
  normalizeStatus,
  readNestedString,
  readString,
  requireTaskId,
  resolveDownloadUrl,
  resolvePollInterval,
  resolveVideoEndpoint,
  throwIfFailed,
} from './video-generation-adapter-support.js';

/**
 * xAI-style video API used by grok2api gateways (e.g. xgrok.planora.chat):
 *
 *   POST   {base}/videos/generations   JSON {model, prompt, ...} -> {request_id}
 *   GET    {base}/videos/{id}          poll -> {status: pending|done|failed, progress}
 *   GET    {base}/videos/{id}/content  download mp4
 *
 * When the poll response includes a `video.url` field (e.g. an absolute
 * vidgen.x.ai URL), prefer downloading from that URL directly. Some gateways
 * do not expose the `/content` endpoint, so `video.url` is the only reliable
 * download source. Fall back to the content endpoint when `video.url` is absent.
 */
export async function generateXgrokVideo(
  options: VideoGenerationAdapterOptions & { signal: AbortSignal; fetchImpl: typeof fetch },
): Promise<GeneratedVideo> {
  const endpoint = resolveVideoEndpoint(options.provider, options.model, 'xgrok-videos');
  const headers = {
    ...bearerHeaders(options.provider, options.apiKey),
    'content-type': 'application/json',
  };

  const body: JsonRecord = {
    model: options.model.id,
    prompt: options.input.prompt.trim(),
  };
  // xgrok accepts snake_case fields only: duration, aspect_ratio, resolution.
  if (options.input.durationSeconds !== undefined)
    body.duration = Math.max(1, Math.floor(options.input.durationSeconds));
  if (options.input.aspectRatio) body.aspect_ratio = options.input.aspectRatio;
  if (options.input.resolution) body.resolution = options.input.resolution;
  if (options.input.inputImage) {
    body.inputImage = {
      bytesBase64Encoded: bytesToBase64(options.input.inputImage.bytes),
      mimeType: options.input.inputImage.mimeType,
    };
  }

  const created = await fetchJson(options.fetchImpl, endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: options.signal,
  });
  const taskId = readString(created, 'request_id') ?? requireTaskId(created, 'xgrok');
  const videosBase = endpoint.replace(/\/generations$/, '');
  const pollEndpoint = `${videosBase}/${encodeURIComponent(taskId)}`;

  while (true) {
    await delay(resolvePollInterval(options.model), options.signal);
    const task = await fetchJson(options.fetchImpl, pollEndpoint, {
      method: 'GET',
      headers,
      signal: options.signal,
    });
    const status = normalizeStatus(readString(task, 'status'));
    if (
      status === 'done' ||
      status === 'completed' ||
      status === 'succeeded' ||
      status === 'success'
    ) {
      const videoUrl = readNestedString(task, ['video', 'url']);
      const downloadSource = videoUrl
        ? resolveDownloadUrl(videoUrl, options.provider.baseUrl)
        : `${pollEndpoint}/content`;
      const video = await downloadVideo(
        options.fetchImpl,
        downloadSource,
        headers,
        options.signal,
      );
      return { ...video, providerTaskId: taskId };
    }
    throwIfFailed(status, task, 'xgrok');
  }
}
