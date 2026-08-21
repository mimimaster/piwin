import type { MediaReadData } from '@piwin/contracts';
import {
  createLimitedPreviewUrlFromHref,
  TRANSCRIPT_THUMB_MAX_EDGE_PX,
} from './media-preview-bitmap';
import { isRemoteMediaAssetRef, REMOTE_MEDIA_ASSET_PREFIX } from './media-path';
import { resolveMediaPreviewUrl } from './media-utils';

export type MediaPreviewReader = (input: {
  sessionId: string;
  assetId: string;
}) => Promise<string | null>;

export type MediaPreviewHost = {
  supportsCommand?: (type: 'media/read') => boolean;
  request: (command: {
    type: 'media/read';
    input: { sessionId: string; assetId: string };
  }) => Promise<{ success: boolean; data?: unknown }>;
};

const previewObjectUrls = new Map<string, string>();

/** Skip composer-local chips; they already have a File blob preview. */
export function mediaPreviewAssetId(path: string, attachmentId: string): string | null {
  if (path.startsWith('pending://')) {
    return null;
  }
  if (isRemoteMediaAssetRef(path)) {
    return path.slice(REMOTE_MEDIA_ASSET_PREFIX.length);
  }
  const trimmed = attachmentId.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function objectUrlFromBase64(mimeType: string, base64Data: string): string {
  const binary = atob(base64Data);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return URL.createObjectURL(new Blob([bytes], { type: mimeType }));
}

/**
 * Fetch vault bytes through `media/read` (ADR 0052). Used when the shell cannot
 * turn a Host path into a Tauri asset URL — remote projection (`remote-asset:`)
 * or a local convertFileSrc miss.
 */
export async function readMediaPreviewViaHost(
  host: MediaPreviewHost,
  input: { sessionId: string; assetId: string },
): Promise<string | null> {
  const cacheKey = `${input.sessionId}:${input.assetId}`;
  const cached = previewObjectUrls.get(cacheKey);
  if (cached) {
    return cached;
  }
  if (host.supportsCommand?.('media/read') === false) {
    return null;
  }
  const response = await host.request({
    type: 'media/read',
    input: { sessionId: input.sessionId, assetId: input.assetId },
  });
  if (!response.success || response.data === undefined) {
    return null;
  }
  const data = response.data as MediaReadData;
  if (data.status !== 'ready' || data.base64Data.length === 0) {
    return null;
  }
  const url = objectUrlFromBase64(data.mimeType, data.base64Data);
  previewObjectUrls.set(cacheKey, url);
  return url;
}

export type TranscriptPreviewUrls = {
  thumbUrl: string | null;
  fullUrl: string | null;
  /** Limited-decode object URL the caller must revoke. Never the cached host URL. */
  ownedThumb: string | null;
};

export async function resolveTranscriptPreviewUrls(input: {
  path: string;
  assetId: string | null;
  sessionId: string | null;
  isVideo: boolean;
  readMedia: MediaPreviewReader | null;
  /** Skip convertFileSrc (used after an <img> load error on a stale asset URL). */
  skipLocal?: boolean;
}): Promise<TranscriptPreviewUrls> {
  if (input.skipLocal !== true) {
    const local = await resolveMediaPreviewUrl(input.path);
    if (local) {
      return finishPreviewUrls(local, input.isVideo);
    }
  }
  if (!input.readMedia || !input.sessionId || !input.assetId) {
    return { thumbUrl: null, fullUrl: null, ownedThumb: null };
  }
  const hostUrl = await input.readMedia({
    sessionId: input.sessionId,
    assetId: input.assetId,
  });
  if (!hostUrl) {
    return { thumbUrl: null, fullUrl: null, ownedThumb: null };
  }
  return finishPreviewUrls(hostUrl, input.isVideo);
}

async function finishPreviewUrls(
  fullUrl: string,
  isVideo: boolean,
): Promise<TranscriptPreviewUrls> {
  if (isVideo) {
    return { thumbUrl: fullUrl, fullUrl, ownedThumb: null };
  }
  const limited = await createLimitedPreviewUrlFromHref(fullUrl, TRANSCRIPT_THUMB_MAX_EDGE_PX);
  return {
    thumbUrl: limited.url,
    fullUrl,
    ownedThumb: limited.owned ? limited.url : null,
  };
}
