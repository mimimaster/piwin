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
  'not-found' | 'outside-media-root' | 'too-large' | 'invalid-request';

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

/** Asset family shown in the unified Studio library. */
export type MediaLibraryKind = 'image' | 'video' | 'file';
export type MediaReadVariant = 'full' | 'thumb';

export const MEDIA_LIST_DEFAULT_LIMIT = 40;
export const MEDIA_LIST_MAX_LIMIT = 80;

/** Midjourney-style grid tiers: dense cells vs current ~148px tiles. */
export const MEDIA_THUMB_EDGE_DENSE_PX = 256;
export const MEDIA_THUMB_EDGE_STANDARD_PX = 384;
export type MediaThumbEdge = typeof MEDIA_THUMB_EDGE_DENSE_PX | typeof MEDIA_THUMB_EDGE_STANDARD_PX;
export const MEDIA_THUMB_EDGES: readonly MediaThumbEdge[] = [
  MEDIA_THUMB_EDGE_DENSE_PX,
  MEDIA_THUMB_EDGE_STANDARD_PX,
];
export const MEDIA_THUMB_MIME = 'image/webp';

export function isMediaThumbEdge(value: unknown): value is MediaThumbEdge {
  return value === MEDIA_THUMB_EDGE_DENSE_PX || value === MEDIA_THUMB_EDGE_STANDARD_PX;
}

export function mediaThumbFileName(assetId: string, edge: MediaThumbEdge): string {
  return `${assetId}.thumb.${edge}.webp`;
}

export function isMediaThumbFileName(fileName: string): boolean {
  return /\.thumb(?:\.(256|384))?\.webp$/i.test(fileName);
}

/** Smallest tier that covers `cssPx * dpr`. Caps at 384. */
export function pickMediaThumbEdge(cssPx: number, devicePixelRatio = 1): MediaThumbEdge {
  const need = Math.max(1, Math.ceil(cssPx * Math.max(1, devicePixelRatio)));
  return need <= MEDIA_THUMB_EDGE_DENSE_PX
    ? MEDIA_THUMB_EDGE_DENSE_PX
    : MEDIA_THUMB_EDGE_STANDARD_PX;
}

export type MediaListInput = {
  /** Omit to list images, videos, and files together. */
  kind?: MediaLibraryKind;
  query?: string;
  cursor?: string;
  limit?: number;
};

/**
 * One vault asset for the unified Studio Library. Addressed by logical
 * identity so remote clients never need a host path. `absolutePath` is
 * local-host only and must be stripped on the remote projection.
 */
export type MediaLibraryItem = {
  assetId: string;
  sessionId: string;
  mimeType: string;
  byteSize: number;
  createdAt: string;
  kind: MediaLibraryKind;
  /** Original filename when the asset came from a file attachment. */
  name?: string;
  prompt?: string;
  model?: string;
  /** Local-host original. Stripped on remote projection. Lightbox only. */
  absolutePath?: string;
  /** Local-host standard (384px) WebP. Stripped on remote projection. Grid only. */
  thumbAbsolutePath?: string;
  /** True when a vault thumb exists (or was just written). Remote uses media/read variant=thumb. */
  hasThumb?: boolean;
};

export type MediaListData = {
  items: MediaLibraryItem[];
  nextCursor?: string;
  total: number;
};

export type MediaDeleteInput = {
  sessionId: string;
  assetId: string;
};

export type MediaDeleteData = {
  deleted: boolean;
  sessionId: string;
  assetId: string;
};

/** Sidecar written next to a vault asset so the Library can search metadata. */
export type MediaLibraryMeta = {
  source: SaveMediaInput['source'];
  kind: MediaLibraryKind;
  createdAt: string;
  name?: string;
  prompt?: string;
  model?: string;
};

export function formatTextModelImageInjection(attachment: TextModelImageInjection): string {
  const dim =
    attachment.width && attachment.height
      ? ` dimensions="${attachment.width}x${attachment.height}"`
      : '';
  return `<attached_image path="${attachment.absolutePath}" mime="${attachment.mimeType}" bytes="${attachment.byteSize}"${dim} />`;
}
