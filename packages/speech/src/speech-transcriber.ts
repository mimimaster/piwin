import type { ModelConfigEntry, ModelProviderConfig } from '@piwin/contracts';
import { SPEECH_MAX_AUDIO_BYTES } from '@piwin/contracts';

export const SPEECH_DEFAULT_TIMEOUT_MS = 120_000;

const AUDIO_MIME_TYPES = new Set([
  'audio/flac',
  'audio/m4a',
  'audio/mp3',
  'audio/mpeg',
  'audio/mpga',
  'audio/mp4',
  'audio/ogg',
  'audio/wav',
  'audio/webm',
  'audio/x-m4a',
  'audio/x-wav',
]);

export type SpeechTranscriptionRequest = {
  provider: ModelProviderConfig;
  model: ModelConfigEntry;
  apiKey: string | null;
  audio: Uint8Array;
  mimeType: string;
  language?: string;
  signal?: AbortSignal;
  fetch?: typeof globalThis.fetch;
};

export type SpeechTranscriptionResult = {
  text: string;
  durationMs: number;
};

export class SpeechTranscriptionError extends Error {
  readonly code: 'validation' | 'provider' | 'network' | 'timeout' | 'cancelled';

  constructor(code: SpeechTranscriptionError['code'], message: string) {
    super(message);
    this.name = 'SpeechTranscriptionError';
    this.code = code;
  }
}

/** Decode and size-check the transient transport payload before creating a request. */
export function decodeBase64Audio(
  base64Data: string,
  maxBytes: number = SPEECH_MAX_AUDIO_BYTES,
): Uint8Array {
  const normalized = base64Data.replace(/\s/g, '');
  if (
    normalized.length === 0 ||
    normalized.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)
  ) {
    throw new SpeechTranscriptionError('validation', 'Audio payload must be valid base64.');
  }
  const padding = normalized.endsWith('==') ? 2 : normalized.endsWith('=') ? 1 : 0;
  const estimatedBytes = (normalized.length / 4) * 3 - padding;
  if (estimatedBytes <= 0) {
    throw new SpeechTranscriptionError('validation', 'Audio payload is empty.');
  }
  if (estimatedBytes > maxBytes) {
    throw new SpeechTranscriptionError('validation', 'Audio recording is too large.');
  }
  const bytes = Buffer.from(normalized, 'base64');
  if (bytes.byteLength === 0) {
    throw new SpeechTranscriptionError('validation', 'Audio payload is empty.');
  }
  return new Uint8Array(bytes);
}

/** Send one OpenAI-compatible multipart transcription request. */
export async function transcribeOpenAiCompatible(
  request: SpeechTranscriptionRequest,
): Promise<SpeechTranscriptionResult> {
  if (request.provider.protocol !== 'openai-compatible') {
    throw new SpeechTranscriptionError(
      'provider',
      'This ASR adapter currently supports OpenAI-compatible providers only.',
    );
  }
  if (request.audio.byteLength === 0 || request.audio.byteLength > SPEECH_MAX_AUDIO_BYTES) {
    throw new SpeechTranscriptionError('validation', 'Audio recording is invalid or too large.');
  }
  const mimeType = normalizeAudioMimeType(request.mimeType);
  const endpoint = buildEndpoint(
    request.provider.baseUrl,
    request.model.routes?.['speech-to-text']?.path,
  );
  const timeoutMs = normalizeTimeout(request.model.routes?.['speech-to-text']?.timeoutMs);
  const fetchImplementation = request.fetch ?? globalThis.fetch;
  if (!fetchImplementation) {
    throw new SpeechTranscriptionError(
      'network',
      'ASR is unavailable because fetch is not supported.',
    );
  }

  const headers = buildHeaders(request.provider, request.apiKey);
  const form = new FormData();
  const fileName = `recording.${extensionForMime(mimeType)}`;
  form.append('file', new Blob([request.audio], { type: mimeType }), fileName);
  form.append('model', request.model.id);
  const language = request.language?.trim();
  if (language) {
    form.append('language', language);
  }

  const controller = new AbortController();
  let externalAbortListener: (() => void) | undefined;
  if (request.signal) {
    if (request.signal.aborted) {
      throw new SpeechTranscriptionError('cancelled', 'ASR request was cancelled.');
    }
    externalAbortListener = () => controller.abort();
    request.signal.addEventListener('abort', externalAbortListener, { once: true });
  }
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();
  try {
    const response = await fetchImplementation(endpoint, {
      method: 'POST',
      headers,
      body: form,
      signal: controller.signal,
    });
    const payload: unknown = await readJson(response);
    if (!response.ok) {
      throw new SpeechTranscriptionError(
        'provider',
        `ASR request failed (${response.status} ${response.statusText || 'request rejected'}).`,
      );
    }
    const text = parseTranscriptText(payload);
    return { text, durationMs: Date.now() - startedAt };
  } catch (error) {
    if (error instanceof SpeechTranscriptionError) {
      throw error;
    }
    if (request.signal?.aborted) {
      throw new SpeechTranscriptionError('cancelled', 'ASR request was cancelled.');
    }
    if (controller.signal.aborted) {
      throw new SpeechTranscriptionError('timeout', 'ASR request timed out.');
    }
    const message =
      error instanceof Error && error.message.trim() ? error.message : 'network error';
    throw new SpeechTranscriptionError('network', `ASR request failed: ${message}`);
  } finally {
    clearTimeout(timeout);
    if (request.signal && externalAbortListener) {
      request.signal.removeEventListener('abort', externalAbortListener);
    }
  }
}

function normalizeAudioMimeType(value: string): string {
  const mimeType = value.split(';', 1)[0]?.trim().toLowerCase() ?? '';
  if (!AUDIO_MIME_TYPES.has(mimeType)) {
    throw new SpeechTranscriptionError(
      'validation',
      `Unsupported audio type: ${mimeType || 'unknown'}.`,
    );
  }
  return mimeType;
}

function buildEndpoint(baseUrl: string, routePath: string | undefined): string {
  const trimmedBaseUrl = baseUrl.trim().replace(/\/+$/, '');
  if (!trimmedBaseUrl) {
    throw new SpeechTranscriptionError('validation', 'ASR provider Base URL is required.');
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmedBaseUrl);
  } catch {
    throw new SpeechTranscriptionError('validation', 'ASR provider Base URL is invalid.');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new SpeechTranscriptionError('validation', 'ASR provider Base URL must use HTTP(S).');
  }
  const path = routePath?.trim() || '/audio/transcriptions';
  if (!path.startsWith('/') || path.includes('://')) {
    throw new SpeechTranscriptionError('validation', 'ASR route must be a relative path.');
  }
  parsed.pathname = `${parsed.pathname.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString();
}

function normalizeTimeout(timeoutMs: number | undefined): number {
  if (timeoutMs === undefined || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return SPEECH_DEFAULT_TIMEOUT_MS;
  }
  return Math.min(Math.round(timeoutMs), 10 * 60 * 1000);
}

function buildHeaders(provider: ModelProviderConfig, apiKey: string | null): Headers {
  const headers = new Headers({ accept: 'application/json' });
  if (apiKey?.trim()) {
    headers.set('authorization', `Bearer ${apiKey.trim()}`);
  }
  const protectedNames = new Set(['authorization', 'content-type']);
  for (const [rawName, rawValue] of Object.entries(provider.headers ?? {})) {
    const name = rawName.trim();
    const value = rawValue.trim();
    if (!name || !value || (protectedNames.has(name.toLowerCase()) && headers.has(name))) {
      continue;
    }
    headers.set(name, value);
  }
  return headers;
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

function parseTranscriptText(payload: unknown): string {
  if (!payload || typeof payload !== 'object') {
    throw new SpeechTranscriptionError('provider', 'ASR response was invalid.');
  }
  const text = (payload as Record<string, unknown>).text;
  if (typeof text !== 'string' || !text.trim()) {
    throw new SpeechTranscriptionError('provider', 'ASR response did not contain transcript text.');
  }
  return text.trim();
}

function extensionForMime(mimeType: string): string {
  switch (mimeType) {
    case 'audio/wav':
    case 'audio/x-wav':
      return 'wav';
    case 'audio/mpeg':
    case 'audio/mp3':
    case 'audio/mpga':
      return 'mp3';
    case 'audio/mp4':
    case 'audio/m4a':
    case 'audio/x-m4a':
      return 'm4a';
    case 'audio/ogg':
      return 'ogg';
    case 'audio/flac':
      return 'flac';
    default:
      return 'webm';
  }
}
