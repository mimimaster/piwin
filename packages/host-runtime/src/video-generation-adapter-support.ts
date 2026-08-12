import type {
  ModelConfigEntry,
  ModelProviderConfig,
  VideoGenerationApiStyle,
} from '@piwin/contracts';
import {
  asRecord,
  readArray,
  readBoolean,
  readNestedString,
  readRecord,
  readString,
  type GeneratedVideo,
  type JsonRecord,
  type VideoGenerationImageInput,
} from './video-generation-types.js';
import { VideoGenConfigError } from './video-generation-types.js';

export {
  asRecord,
  readArray,
  readBoolean,
  readNestedString,
  readRecord,
  readString,
} from './video-generation-types.js';

export const DEFAULT_VIDEO_TIMEOUT_MS = 15 * 60 * 1000;
export const DEFAULT_POLL_INTERVAL_MS = 5_000;

export function resolveVideoApiStyle(
  provider: ModelProviderConfig,
  model: ModelConfigEntry,
): VideoGenerationApiStyle {
  const configured = model.routes?.['video-generation']?.apiStyle;
  if (isVideoApiStyle(configured)) return configured;
  if (provider.protocol === 'google-gemini') return 'google-veo';
  if (provider.protocol === 'openai-compatible') return 'openai-videos';
  return 'custom';
}

export function resolveVideoEndpoint(
  provider: ModelProviderConfig,
  model: ModelConfigEntry,
  style: VideoGenerationApiStyle,
): string {
  const configuredPath = model.routes?.['video-generation']?.path;
  const path =
    typeof configuredPath === 'string' && configuredPath.trim()
      ? configuredPath.trim()
      : defaultVideoPath(style);
  if (/^https?:\/\//i.test(path)) {
    throw new VideoGenConfigError(
      'video_gen: video route "path" must be relative to the provider base URL, not an absolute URL.',
    );
  }
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const resolvedPath = normalizedPath.replace('{model}', encodeURIComponent(model.id));
  return `${provider.baseUrl.replace(/\/+$/, '')}${resolvedPath}`;
}

function defaultVideoPath(style: VideoGenerationApiStyle): string {
  switch (style) {
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

function isVideoApiStyle(value: unknown): value is VideoGenerationApiStyle {
  return (
    value === 'openai-videos' ||
    value === 'google-veo' ||
    value === 'runway-tasks' ||
    value === 'luma-generations' ||
    value === 'minimax-tasks' ||
    value === 'xgrok-videos' ||
    value === 'custom'
  );
}

export function resolvePollInterval(model: ModelConfigEntry): number {
  const configured = model.routes?.['video-generation']?.pollIntervalMs;
  return Math.max(250, Math.min(60_000, configured ?? DEFAULT_POLL_INTERVAL_MS));
}

export function normalizeTimeout(value: number): number {
  return Math.max(
    10_000,
    Math.min(60 * 60 * 1000, Number.isFinite(value) ? value : DEFAULT_VIDEO_TIMEOUT_MS),
  );
}

export async function delay(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) throw new VideoGenConfigError('video_gen: generation aborted');
  await new Promise<void>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout>;
    const onAbort = () => {
      clearTimeout(timer);
      reject(new VideoGenConfigError('video_gen: generation aborted'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) {
      onAbort();
      return;
    }
    timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, milliseconds);
  });
}

export async function fetchJson(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
): Promise<JsonRecord> {
  const response = await fetchImpl(url, init);
  if (!response.ok) {
    throw new VideoGenConfigError(`video_gen: provider returned HTTP ${response.status}`);
  }
  let value: unknown;
  try {
    value = await response.json();
  } catch {
    throw new VideoGenConfigError('video_gen: provider returned invalid JSON');
  }
  const record = asRecord(value);
  if (!record) throw new VideoGenConfigError('video_gen: provider returned a non-object response');
  return record;
}

export async function downloadVideo(
  fetchImpl: typeof fetch,
  url: string,
  headers: Record<string, string>,
  signal: AbortSignal,
): Promise<Omit<GeneratedVideo, 'providerTaskId'>> {
  const response = await fetchImpl(url, { method: 'GET', headers, signal });
  if (!response.ok) {
    throw new VideoGenConfigError(`video_gen: failed to download video (HTTP ${response.status})`);
  }
  const contentType = response.headers?.get?.('content-type')?.split(';')[0]?.trim().toLowerCase();
  const mimeType =
    contentType === 'video/webm' || contentType === 'video/quicktime' || contentType === 'video/mp4'
      ? contentType
      : 'video/mp4';
  return { bytes: new Uint8Array(await response.arrayBuffer()), mimeType };
}

export function bearerHeaders(
  provider: ModelProviderConfig,
  apiKey: string,
): Record<string, string> {
  return { ...provider.headers, authorization: `Bearer ${apiKey}` };
}

export function googleHeaders(
  provider: ModelProviderConfig,
  apiKey: string,
): Record<string, string> {
  return { ...provider.headers, 'x-goog-api-key': apiKey };
}

export function resolveOperationUrl(provider: ModelProviderConfig, operationName: string): string {
  if (/^https?:\/\//i.test(operationName)) return operationName;
  const base = provider.baseUrl.replace(/\/+$/, '');
  return `${base}/${operationName.replace(/^\/+/, '')}`;
}

export function resolveDownloadUrl(rawUrl: string, baseUrl: string): string {
  if (/^https?:\/\//i.test(rawUrl)) return rawUrl;
  if (rawUrl.startsWith('/')) {
    const base = new URL(baseUrl);
    return `${base.protocol}//${base.host}${rawUrl}`;
  }
  return `${baseUrl.replace(/\/+$/, '')}/${rawUrl.replace(/^\/+/, '')}`;
}

export function extractGoogleVideoUri(operation: JsonRecord): string | undefined {
  const response = readRecord(operation, 'response');
  const generateResponse = readRecord(response, 'generateVideoResponse');
  const sampleArrays = [
    readArray(generateResponse, 'generatedSamples'),
    readArray(response, 'generatedVideos'),
    readArray(response, 'generatedSamples'),
  ];
  for (const samples of sampleArrays) {
    const first = samples?.[0];
    const uri =
      readNestedString(first, ['video', 'uri']) ??
      readString(first, 'uri') ??
      readNestedString(first, ['video', 'url']);
    if (uri) return uri;
  }
  return undefined;
}

export function extractRunwayOutputUrl(task: JsonRecord): string | undefined {
  const output = readArray(task, 'output');
  const first = output?.[0];
  if (typeof first === 'string' && first.trim()) return first;
  return readString(asRecord(first), 'url');
}

export function requireTaskId(task: JsonRecord, providerName: string): string {
  const id = readString(task, 'id') ?? readString(task, 'task_id');
  if (!id) throw new VideoGenConfigError(`video_gen: ${providerName} returned no task id`);
  return id;
}

export function throwIfFailed(
  status: string | undefined,
  task: JsonRecord,
  providerName: string,
): void {
  if (
    status !== 'failed' &&
    status !== 'canceled' &&
    status !== 'cancelled' &&
    status !== 'error'
  ) {
    return;
  }
  const detail =
    readNestedString(task, ['error', 'message']) ??
    readString(task, 'failure_reason') ??
    readString(task, 'error') ??
    `status=${status}`;
  throw new VideoGenConfigError(`video_gen: ${providerName} task failed: ${detail}`);
}

export function normalizeStatus(value: string | undefined): string | undefined {
  return value
    ?.trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
}

export function normalizeOpenAiSeconds(value: number | undefined): string {
  if (value === 8 || value === 12) return String(value);
  return '4';
}

export function normalizeRunwayDuration(value: number | undefined): 5 | 10 {
  return value !== undefined && value >= 8 ? 10 : 5;
}

export function normalizeRunwayRatio(value: string | undefined): string {
  switch (value) {
    case '9:16':
      return '720:1280';
    case '1:1':
      return '960:960';
    case '4:3':
      return '1440:1080';
    case '3:4':
      return '1080:1440';
    default:
      return '1280:720';
  }
}

export function normalizeLumaDuration(value: number): string {
  return value >= 8 ? '9s' : '5s';
}

export function toDataUrl(input: VideoGenerationImageInput): string {
  return `data:${input.mimeType};base64,${bytesToBase64(input.bytes)}`;
}

export function bytesToBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}
