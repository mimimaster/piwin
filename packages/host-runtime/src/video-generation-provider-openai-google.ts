import type {
  GeneratedVideo,
  JsonRecord,
  VideoGenerationAdapterOptions,
} from './video-generation-types.js';
import { VideoGenConfigError } from './video-generation-types.js';
import {
  bearerHeaders,
  bytesToBase64,
  delay,
  downloadVideo,
  extractGoogleVideoUri,
  fetchJson,
  googleHeaders,
  normalizeOpenAiSeconds,
  normalizeStatus,
  readBoolean,
  readNestedString,
  readString,
  requireTaskId,
  resolveDownloadUrl,
  resolveOperationUrl,
  resolvePollInterval,
  resolveVideoEndpoint,
  throwIfFailed,
} from './video-generation-adapter-support.js';

export async function generateOpenAiVideo(
  options: VideoGenerationAdapterOptions & { signal: AbortSignal; fetchImpl: typeof fetch },
): Promise<GeneratedVideo> {
  const endpoint = resolveVideoEndpoint(options.provider, options.model, 'openai-videos');
  const form = new FormData();
  form.set('model', options.model.id);
  form.set('prompt', options.input.prompt.trim());
  form.set('seconds', normalizeOpenAiSeconds(options.input.durationSeconds));
  form.set('size', options.input.size ?? '1280x720');
  if (options.input.inputImage) {
    form.set(
      'input_reference',
      new Blob([options.input.inputImage.bytes], { type: options.input.inputImage.mimeType }),
      options.input.inputImage.fileName,
    );
  }

  const headers = bearerHeaders(options.provider, options.apiKey);
  delete headers['content-type'];
  delete headers['Content-Type'];
  let task = await fetchJson(options.fetchImpl, endpoint, {
    method: 'POST',
    headers,
    body: form,
    signal: options.signal,
  });
  const taskId = requireTaskId(task, 'OpenAI');

  while (true) {
    const status = normalizeStatus(readString(task, 'status'));
    if (status === 'completed') {
      const inlineUrl =
        readString(task, 'video_url') ??
        readNestedString(task, ['output', 'url']) ??
        readNestedString(task, ['video', 'url']);
      const video = inlineUrl
        ? await downloadVideo(options.fetchImpl, inlineUrl, headers, options.signal)
        : await downloadVideo(
            options.fetchImpl,
            `${endpoint}/${encodeURIComponent(taskId)}/content`,
            headers,
            options.signal,
          );
      return { ...video, providerTaskId: taskId };
    }
    throwIfFailed(status, task, 'OpenAI');
    await delay(resolvePollInterval(options.model), options.signal);
    task = await fetchJson(options.fetchImpl, `${endpoint}/${encodeURIComponent(taskId)}`, {
      method: 'GET',
      headers,
      signal: options.signal,
    });
  }
}

export async function generateGoogleVeoVideo(
  options: VideoGenerationAdapterOptions & { signal: AbortSignal; fetchImpl: typeof fetch },
): Promise<GeneratedVideo> {
  const endpoint = resolveVideoEndpoint(options.provider, options.model, 'google-veo');
  const instance: JsonRecord = { prompt: options.input.prompt.trim() };
  if (options.input.inputImage) {
    instance.image = {
      bytesBase64Encoded: bytesToBase64(options.input.inputImage.bytes),
      mimeType: options.input.inputImage.mimeType,
    };
  }
  const parameters: JsonRecord = {
    aspectRatio: options.input.aspectRatio ?? '16:9',
  };
  if (options.input.durationSeconds !== undefined) {
    parameters.durationSeconds = Math.max(1, Math.floor(options.input.durationSeconds));
  }
  if (options.input.resolution) parameters.resolution = options.input.resolution;

  const headers = googleHeaders(options.provider, options.apiKey);
  let operation = await fetchJson(options.fetchImpl, endpoint, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({ instances: [instance], parameters }),
    signal: options.signal,
  });
  const operationName =
    readString(operation, 'name') ?? readNestedString(operation, ['operation', 'name']);
  if (!operationName) {
    throw new VideoGenConfigError('video_gen: Google Veo returned no operation name');
  }
  const operationUrl = resolveOperationUrl(options.provider, operationName);

  while (true) {
    if (readBoolean(operation, 'done') === true) {
      const failure = readNestedString(operation, ['error', 'message']);
      if (failure) throw new VideoGenConfigError(`video_gen: Google Veo failed: ${failure}`);
      const uri = extractGoogleVideoUri(operation);
      if (!uri) throw new VideoGenConfigError('video_gen: Google Veo returned no video URI');
      const video = await downloadVideo(
        options.fetchImpl,
        resolveDownloadUrl(uri, options.provider.baseUrl),
        headers,
        options.signal,
      );
      return { ...video, providerTaskId: operationName };
    }
    await delay(resolvePollInterval(options.model), options.signal);
    operation = await fetchJson(options.fetchImpl, operationUrl, {
      method: 'GET',
      headers,
      signal: options.signal,
    });
  }
}
