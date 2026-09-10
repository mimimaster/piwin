import type { MediaAttachmentRef, MediaLibraryItem } from '@piwin/contracts';
import { REMOTE_MEDIA_ASSET_PREFIX, toMediaAttachmentRef } from '@piwin/contracts';
import type { MediaImageTarget } from './context-menu/types.js';
import { fileNameFromLocalPath } from './local-file-actions.js';
import { looksLikeFilesystemWorkspacePath } from './workspace-open.js';

const EXT_BY_MIME: Readonly<Record<string, string>> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
  'image/avif': 'avif',
  'image/bmp': 'bmp',
};

const BARE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True when a name is an internal asset ref, not something worth showing a user. */
export function isOpaqueMediaName(name: string): boolean {
  const s = name.trim();
  return (
    s === '' ||
    s.startsWith(REMOTE_MEDIA_ASSET_PREFIX) ||
    s.startsWith('asset:') ||
    BARE_UUID.test(s)
  );
}

/** A safe suggested filename for Save As — never `remote-asset:<uuid>`. */
export function mediaDownloadFileName(fileName: string, mimeType: string): string {
  if (!isOpaqueMediaName(fileName)) {
    return fileName;
  }
  return `image.${EXT_BY_MIME[mimeType] ?? 'png'}`;
}

function fileNameForAttachment(attachment: MediaAttachmentRef): string {
  const named = attachment.name?.trim();
  if (named) {
    return named;
  }
  return fileNameFromLocalPath(attachment.path);
}

export function buildMediaImageTarget(input: {
  attachment: MediaAttachmentRef;
  sessionId?: string | null;
  srcUrl?: string | null;
  inLightbox?: boolean;
}): MediaImageTarget {
  const fileName = fileNameForAttachment(input.attachment);
  const target: MediaImageTarget = {
    surface: 'media-image',
    label: fileName,
    fileName,
    mimeType: input.attachment.mimeType,
    attachment: input.attachment,
    assetId: input.attachment.id,
  };
  if (input.sessionId) {
    target.sessionId = input.sessionId;
  }
  if (input.srcUrl) {
    target.srcUrl = input.srcUrl;
  }
  if (input.inLightbox === true) {
    target.inLightbox = true;
  }
  if (looksLikeFilesystemWorkspacePath(input.attachment.path)) {
    target.absolutePath = input.attachment.path;
  }
  return target;
}

export function mediaAttachmentFromLibraryItem(item: MediaLibraryItem): MediaAttachmentRef {
  const asset: Parameters<typeof toMediaAttachmentRef>[0] = {
    id: item.assetId,
    mimeType: item.mimeType,
    byteSize: item.byteSize,
  };
  if (item.absolutePath) {
    asset.absolutePath = item.absolutePath;
  }
  if (item.name) {
    asset.name = item.name;
  }
  return toMediaAttachmentRef(asset, 'generated');
}

export function buildLibraryMediaImageTarget(
  item: MediaLibraryItem,
  options?: { inLightbox?: boolean; srcUrl?: string | null },
): MediaImageTarget {
  return buildMediaImageTarget({
    attachment: mediaAttachmentFromLibraryItem(item),
    sessionId: item.sessionId,
    ...(options?.srcUrl ? { srcUrl: options.srcUrl } : {}),
    ...(options?.inLightbox === true ? { inLightbox: true } : {}),
  });
}
