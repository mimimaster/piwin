import type {
  ModelConfigEntry,
  ModelProviderConfig,
  VideoGenerationApiStyle,
} from '@piwin/contracts';

export class VideoGenConfigError extends Error {
  override readonly name = 'VideoGenConfigError';
}

export type VideoGenerationInput = {
  prompt: string;
  durationSeconds?: number;
  aspectRatio?: string;
  size?: string;
  resolution?: string;
  inputImage?: VideoGenerationImageInput;
};

export type VideoGenerationImageInput = {
  bytes: Uint8Array;
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
  fileName: string;
};

export type VideoGenerationAdapterOptions = {
  provider: ModelProviderConfig;
  model: ModelConfigEntry;
  apiKey: string;
  input: VideoGenerationInput;
  signal: AbortSignal;
  fetchImpl?: typeof fetch;
};

export type GeneratedVideo = {
  bytes: Uint8Array;
  mimeType: 'video/mp4' | 'video/webm' | 'video/quicktime';
  providerTaskId: string;
};

export type VideoAdapterStyle = Exclude<VideoGenerationApiStyle, 'custom'>;

export type JsonRecord = Record<string, unknown>;

export function asRecord(value: unknown): JsonRecord | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined;
  }
  return value as JsonRecord;
}

export function readString(value: unknown, key: string): string | undefined {
  const record = asRecord(value);
  const candidate = record?.[key];
  return typeof candidate === 'string' && candidate.trim() ? candidate : undefined;
}

export function readNumber(value: unknown, key: string): number | undefined {
  const record = asRecord(value);
  const candidate = record?.[key];
  return typeof candidate === 'number' && Number.isFinite(candidate) ? candidate : undefined;
}

export function readBoolean(value: unknown, key: string): boolean | undefined {
  const record = asRecord(value);
  const candidate = record?.[key];
  return typeof candidate === 'boolean' ? candidate : undefined;
}

export function readRecord(value: unknown, key: string): JsonRecord | undefined {
  return asRecord(asRecord(value)?.[key]);
}

export function readArray(value: unknown, key: string): readonly unknown[] | undefined {
  const candidate = asRecord(value)?.[key];
  return Array.isArray(candidate) ? candidate : undefined;
}

export function readNestedString(value: unknown, path: readonly string[]): string | undefined {
  let current: unknown = value;
  for (const key of path) {
    current = asRecord(current)?.[key];
    if (current === undefined) return undefined;
  }
  return typeof current === 'string' && current.trim() ? current : undefined;
}
