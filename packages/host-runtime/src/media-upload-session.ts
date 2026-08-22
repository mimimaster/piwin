/**
 * In-memory assembler for chunked `media/save-*` uploads.
 * Bytes stay off the 1 MiB Host JSON frame; Host is still the vault writer.
 */
import { randomUUID } from 'node:crypto';
import type { AttachmentContentKind, SaveMediaInput } from '@piwin/contracts';
import { MEDIA_SAVE_CHUNK_MAX_BYTES } from '@piwin/contracts';

const UPLOAD_TTL_MS = 10 * 60 * 1000;

export type MediaUploadSession = {
  uploadId: string;
  sessionId: string;
  mimeType: string;
  name?: string;
  contentKind?: AttachmentContentKind;
  source: SaveMediaInput['source'];
  declaredByteSize: number;
  nextIndex: number;
  receivedBytes: number;
  chunks: Uint8Array[];
  createdAt: number;
};

const pendingUploads = new Map<string, MediaUploadSession>();

function sweepExpired(now = Date.now()): void {
  for (const [uploadId, session] of pendingUploads) {
    if (now - session.createdAt > UPLOAD_TTL_MS) {
      pendingUploads.delete(uploadId);
    }
  }
}

export function beginMediaUpload(input: {
  sessionId: string;
  mimeType: string;
  name?: string;
  contentKind?: AttachmentContentKind;
  source: SaveMediaInput['source'];
  byteSize: number;
  maxPasteBytes: number;
}): MediaUploadSession {
  sweepExpired();
  if (!Number.isSafeInteger(input.byteSize) || input.byteSize <= 0) {
    throw new Error('media upload byteSize must be a positive integer');
  }
  if (input.byteSize > input.maxPasteBytes) {
    throw new Error(`media too large: ${input.byteSize} > max ${input.maxPasteBytes}`);
  }
  const session: MediaUploadSession = {
    uploadId: randomUUID(),
    sessionId: input.sessionId,
    mimeType: input.mimeType,
    source: input.source,
    declaredByteSize: input.byteSize,
    nextIndex: 0,
    receivedBytes: 0,
    chunks: [],
    createdAt: Date.now(),
  };
  if (input.name !== undefined) {
    session.name = input.name;
  }
  if (input.contentKind !== undefined) {
    session.contentKind = input.contentKind;
  }
  pendingUploads.set(session.uploadId, session);
  return session;
}

export function appendMediaUploadChunk(input: {
  uploadId: string;
  chunkIndex: number;
  bytes: Uint8Array;
  maxPasteBytes: number;
}): MediaUploadSession {
  sweepExpired();
  const session = pendingUploads.get(input.uploadId);
  if (!session) {
    throw new Error('media upload is not active');
  }
  if (!Number.isSafeInteger(input.chunkIndex) || input.chunkIndex !== session.nextIndex) {
    throw new Error('media upload chunk index is out of order');
  }
  if (input.bytes.byteLength === 0) {
    throw new Error('media upload chunk is empty');
  }
  if (input.bytes.byteLength > MEDIA_SAVE_CHUNK_MAX_BYTES) {
    throw new Error(
      `media upload chunk too large: ${input.bytes.byteLength} > ${MEDIA_SAVE_CHUNK_MAX_BYTES}`,
    );
  }
  const nextReceived = session.receivedBytes + input.bytes.byteLength;
  if (nextReceived > session.declaredByteSize || nextReceived > input.maxPasteBytes) {
    throw new Error('media upload exceeded declared size');
  }
  session.chunks.push(input.bytes);
  session.receivedBytes = nextReceived;
  session.nextIndex += 1;
  return session;
}

export function takeMediaUpload(uploadId: string): MediaUploadSession {
  sweepExpired();
  const session = pendingUploads.get(uploadId);
  if (!session) {
    throw new Error('media upload is not active');
  }
  if (session.receivedBytes !== session.declaredByteSize) {
    throw new Error(
      `media upload incomplete: ${session.receivedBytes} !== ${session.declaredByteSize}`,
    );
  }
  pendingUploads.delete(uploadId);
  return session;
}

export function abortMediaUpload(uploadId: string): boolean {
  return pendingUploads.delete(uploadId);
}

export function concatMediaUpload(session: MediaUploadSession): Uint8Array {
  const bytes = new Uint8Array(session.receivedBytes);
  let offset = 0;
  for (const chunk of session.chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/** Test-only. */
export function resetMediaUploads(): void {
  pendingUploads.clear();
}
