import type { AttachmentContentKind } from './attachment.js';

export type SavedMediaAsset = {
  id: string;
  sessionId: string;
  absolutePath: string;
  mimeType: string;
  name?: string;
  contentKind?: AttachmentContentKind;
  byteSize: number;
  width?: number;
  height?: number;
  createdAt: string;
};

export type SaveMediaInput = {
  sessionId: string;
  bytes: Uint8Array;
  mimeType: string;
  name?: string;
  contentKind?: AttachmentContentKind;
  source: 'paste' | 'drop' | 'file-picker' | 'generated';
};

/**
 * Raw bytes per `media/save-chunk`. Base64 expands ~4/3; keep the encoded
 * command under `HOST_WIRE_HARD_FRAME_BYTES` (1 MiB) with envelope headroom.
 */
export const MEDIA_SAVE_CHUNK_MAX_BYTES = 384 * 1024;

export type MediaSaveBeginInput = {
  sessionId: string;
  mimeType: string;
  name?: string;
  contentKind?: AttachmentContentKind;
  source: SaveMediaInput['source'];
  byteSize: number;
};

export type MediaSaveBeginData = {
  uploadId: string;
  chunkMaxBytes: number;
};

export type MediaSaveChunkInput = {
  uploadId: string;
  chunkIndex: number;
  base64Data: string;
};

export type MediaSaveChunkData = {
  uploadId: string;
  receivedBytes: number;
};

export type MediaSaveFinishInput = {
  uploadId: string;
};

export type MediaSaveAbortInput = {
  uploadId: string;
};

export type MediaSaveAbortData = {
  uploadId: string;
};

/** Text injected into text-only model prompts. */
export type TextModelImageInjection = {
  absolutePath: string;
  mimeType: string;
  byteSize: number;
  width?: number;
  height?: number;
};

/**
 * Stable failure reasons for media/read (ADR 0052). Remote-safe: the payload
 * never carries host-absolute paths in either variant.
 */
export type MediaReadFailureReason =
  | 'not-found'
  | 'outside-media-root'
  | 'too-large'
  | 'invalid-request';

export type MediaReadData =
  | {
      status: 'ready';
      assetId: string;
      sessionId: string;
      mimeType: string;
      byteSize: number;
      /** Bytes are base64 only while crossing the client-to-host transport. */
      base64Data: string;
    }
  | {
      status: 'unavailable';
      reason: MediaReadFailureReason;
      suggestion?: string;
    };

export function formatTextModelImageInjection(attachment: TextModelImageInjection): string {
  const dim =
    attachment.width && attachment.height
      ? ` dimensions="${attachment.width}x${attachment.height}"`
      : '';
  return `<attached_image path="${attachment.absolutePath}" mime="${attachment.mimeType}" bytes="${attachment.byteSize}"${dim} />`;
}
