import {
  MEDIA_READ_CHUNK_MAX_BYTES,
  type MediaReadCommandInput,
  type MediaReadData,
  type MediaReadVariant,
  type MediaThumbEdge,
} from '@piwin/contracts';

export type MediaHostReadClient = {
  supportsCommand?: (type: 'media/read') => boolean;
  request: (command: {
    type: 'media/read';
    input: MediaReadCommandInput;
  }) => Promise<{ success: boolean; data?: unknown }>;
};

/** Assembled original cap — matches video_gen vault write budget. */
export const MEDIA_READ_ASSEMBLE_MAX_BYTES = 50 * 1024 * 1024;

export function decodeBase64ToBytes(base64Data: string): Uint8Array {
  const binary = atob(base64Data);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export function objectUrlFromBytes(mimeType: string, bytes: Uint8Array): string {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return URL.createObjectURL(new Blob([buffer], { type: mimeType }));
}

function asMediaReadData(value: unknown): MediaReadData | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const record = value as { status?: unknown };
  if (record.status === 'unavailable') {
    return value as MediaReadData;
  }
  if (record.status !== 'ready') {
    return null;
  }
  return value as MediaReadData;
}

async function requestMediaRead(
  host: MediaHostReadClient,
  input: MediaReadCommandInput,
): Promise<MediaReadData | null> {
  const response = await host.request({ type: 'media/read', input });
  if (!response.success || response.data === undefined) {
    return null;
  }
  return asMediaReadData(response.data);
}

async function readMediaObjectUrlChunked(
  host: MediaHostReadClient,
  input: { sessionId: string; assetId: string },
): Promise<string | null> {
  const parts: Uint8Array[] = [];
  let offset = 0;
  let total = Number.POSITIVE_INFINITY;
  let mimeType = 'application/octet-stream';
  while (offset < total) {
    if (offset > MEDIA_READ_ASSEMBLE_MAX_BYTES) {
      return null;
    }
    const slice = await requestMediaRead(host, {
      sessionId: input.sessionId,
      assetId: input.assetId,
      offset,
      length: MEDIA_READ_CHUNK_MAX_BYTES,
    });
    if (slice === null || slice.status !== 'ready') {
      return null;
    }
    mimeType = slice.mimeType;
    total = slice.byteSize;
    const bytes = decodeBase64ToBytes(slice.base64Data);
    if (bytes.byteLength === 0) {
      break;
    }
    parts.push(bytes);
    offset += bytes.byteLength;
  }
  if (parts.length === 0 || !Number.isFinite(total) || offset < total) {
    return null;
  }
  const assembled = new Uint8Array(offset);
  let cursor = 0;
  for (const part of parts) {
    assembled.set(part, cursor);
    cursor += part.byteLength;
  }
  return objectUrlFromBytes(mimeType, assembled);
}

/**
 * Fetch vault bytes through `media/read`. Whole-file first; `too-large`
 * retries as offset/length slices so generated video can cross the wire cap.
 */
export async function readMediaObjectUrlViaHost(
  host: MediaHostReadClient,
  input: {
    sessionId: string;
    assetId: string;
    variant?: MediaReadVariant;
    thumbEdge?: MediaThumbEdge;
  },
): Promise<string | null> {
  if (host.supportsCommand?.('media/read') === false) {
    return null;
  }
  const first = await requestMediaRead(host, {
    sessionId: input.sessionId,
    assetId: input.assetId,
    ...(input.variant !== undefined ? { variant: input.variant } : {}),
    ...(input.thumbEdge !== undefined ? { thumbEdge: input.thumbEdge } : {}),
  });
  if (first === null) {
    return null;
  }
  if (first.status === 'unavailable') {
    if (first.reason === 'too-large' && input.variant !== 'thumb') {
      return readMediaObjectUrlChunked(host, input);
    }
    return null;
  }
  if (first.base64Data.length === 0) {
    return null;
  }
  return objectUrlFromBytes(first.mimeType, decodeBase64ToBytes(first.base64Data));
}
