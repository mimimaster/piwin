/** Desktop/CLI host IPC media command/response helpers. */

import type { MediaAttachmentRef } from './host.js';
import type {
  MediaReadVariant,
  MediaThumbEdge,
  SavedMediaAsset,
  SaveMediaInput,
} from './media.js';

/**
 * Bytes are base64 only while crossing the desktop-to-host transport.
 * The host persists them immediately; callers must never put this payload in a model prompt.
 */
export type MediaSaveCommandInput = {
  sessionId: string;
  mimeType: string;
  name?: string;
  contentKind?: import('./attachment.js').AttachmentContentKind;
  source: SaveMediaInput['source'];
  base64Data: string;
};

export type MediaSaveData = {
  asset: SavedMediaAsset;
};

/**
 * Addressed by logical identity (sessionId + assetId) — never by a
 * host-absolute path — so remote clients can fetch vault bytes without
 * learning or forging host paths (ADR 0052).
 */
export type MediaReadCommandInput = {
  sessionId: string;
  assetId: string;
  maxBytes?: number;
  /** `thumb` returns a grid WebP sidecar. Default is the original file. */
  variant?: MediaReadVariant;
  /** 256 (dense) or 384 (standard). Ignored unless variant is `thumb`. */
  thumbEdge?: MediaThumbEdge;
  /**
   * Byte offset into the vault file. With `length`, returns a slice so
   * generated video can cross the Host wire cap without a 1 MiB JSON frame.
   */
  offset?: number;
  /** Slice length in bytes. Capped by the Host to the media/read wire budget. */
  length?: number;
};

/**
 * Remote `media/save` strips Host filesystem paths. Prompt attachments must
 * then use the opaque `remote-asset:<id>` ref the Host already remaps.
 */
export const REMOTE_MEDIA_ASSET_PREFIX = 'remote-asset:';

/** Local save (has `absolutePath`) or remote projection (id only). */
export type MediaSaveAssetForPrompt = Pick<SavedMediaAsset, 'id' | 'mimeType' | 'byteSize'> &
  Partial<Pick<SavedMediaAsset, 'absolutePath' | 'name' | 'contentKind' | 'width' | 'height'>>;

/** The UI-facing form of a saved asset accepted by PromptInput.attachments. */
export function toMediaAttachmentRef(
  asset: MediaSaveAssetForPrompt,
  source: SaveMediaInput['source'],
): MediaAttachmentRef {
  const hostPath = asset.absolutePath?.trim();
  const path =
    hostPath !== undefined && hostPath.length > 0
      ? hostPath
      : `${REMOTE_MEDIA_ASSET_PREFIX}${asset.id}`;
  const attachment: MediaAttachmentRef = {
    id: asset.id,
    kind: 'media',
    path,
    mimeType: asset.mimeType,
    byteSize: asset.byteSize,
    source,
  };
  if (asset.name !== undefined) {
    attachment.name = asset.name;
  }
  if (asset.contentKind !== undefined) {
    attachment.contentKind = asset.contentKind;
  }
  if (asset.width !== undefined) {
    attachment.width = asset.width;
  }
  if (asset.height !== undefined) {
    attachment.height = asset.height;
  }
  return attachment;
}
