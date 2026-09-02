import {
  createLimitedPreviewUrlFromHref,
  TRANSCRIPT_THUMB_MAX_EDGE_PX,
} from './media-preview-bitmap';
import { isRemoteMediaAssetRef, REMOTE_MEDIA_ASSET_PREFIX } from './media-path';
import { readMediaObjectUrlViaHost, type MediaHostReadClient } from './media-host-read';
import { resolveMediaPreviewUrl } from './media-utils';
import { createPlayableMediaObjectUrl } from './playable-media-url';

export type MediaPreviewReader = (input: {
  sessionId: string;
  assetId: string;
}) => Promise<string | null>;

export type MediaPreviewHost = MediaHostReadClient;

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

/**
 * Fetch vault bytes through `media/read` (ADR 0052). Used when the shell cannot
 * turn a Host path into a Tauri asset URL — remote projection (`remote-asset:`),
 * a local convertFileSrc miss, or a video whose asset URL is not playable.
 * Oversized originals (generated mp4) are assembled from ranged slices.
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
  const url = await readMediaObjectUrlViaHost(host, input);
  if (!url) {
    return null;
  }
  previewObjectUrls.set(cacheKey, url);
  return url;
}

export type TranscriptPreviewUrls = {
  thumbUrl: string | null;
  fullUrl: string | null;
  /** Limited-decode object URL the caller must revoke. Never the cached host URL. */
  ownedThumb: string | null;
};

function isSafeVaultSegment(value: string): boolean {
  return value.length > 0 && !/[\\/]/.test(value) && !value.includes('..');
}

function extensionForVaultMime(mimeType: string): string {
  const normalized = mimeType.trim().toLowerCase();
  if (normalized === 'video/webm') return '.webm';
  if (normalized === 'video/quicktime') return '.mov';
  if (normalized.startsWith('video/')) return '.mp4';
  if (normalized === 'image/jpeg' || normalized === 'image/jpg') return '.jpg';
  if (normalized === 'image/webp') return '.webp';
  if (normalized === 'image/gif') return '.gif';
  return '.png';
}

/** Host vault layout: `~/.piwin/media/<sessionId>/<assetId>.<ext>`. */
export function vaultMediaAbsolutePath(
  home: string,
  sessionId: string,
  assetId: string,
  mimeType: string,
): string | null {
  if (!isSafeVaultSegment(sessionId) || !isSafeVaultSegment(assetId)) {
    return null;
  }
  const normalizedHome = home.replace(/\\/g, '/').replace(/\/$/, '');
  if (normalizedHome.length === 0) {
    return null;
  }
  return `${normalizedHome}/.piwin/media/${sessionId}/${assetId}${extensionForVaultMime(mimeType)}`;
}

async function resolveVaultHome(explicit?: string): Promise<string | null> {
  const trimmed = explicit?.trim();
  if (trimmed) {
    return trimmed;
  }
  try {
    const { homeDir } = await import('@tauri-apps/api/path');
    const home = await homeDir();
    return home.replace(/[/\\]$/, '');
  } catch {
    return null;
  }
}

async function resolveReconstructedVaultUrl(input: {
  isVideo: boolean;
  sessionId: string | null;
  assetId: string | null;
  mimeType?: string | undefined;
  vaultHome?: string | undefined;
}): Promise<string | null> {
  if (!input.isVideo || !input.sessionId || !input.assetId) {
    return null;
  }
  const home = await resolveVaultHome(input.vaultHome);
  if (!home) {
    return null;
  }
  const guessed = vaultMediaAbsolutePath(
    home,
    input.sessionId,
    input.assetId,
    input.mimeType ?? 'video/mp4',
  );
  return guessed ? resolveMediaPreviewUrl(guessed) : null;
}

export async function resolveTranscriptPreviewUrls(input: {
  path: string;
  assetId: string | null;
  sessionId: string | null;
  isVideo: boolean;
  readMedia: MediaPreviewReader | null;
  /** Skip convertFileSrc (used after an <img> load error on a stale asset URL). */
  skipLocal?: boolean;
  mimeType?: string | undefined;
  /** Test seam; production reads Tauri `homeDir`. */
  vaultHome?: string | undefined;
}): Promise<TranscriptPreviewUrls> {
  if (input.skipLocal !== true) {
    const local =
      (await resolveMediaPreviewUrl(input.path)) ?? (await resolveReconstructedVaultUrl(input));
    if (local) {
      if (!input.isVideo) {
        return finishImagePreview(local);
      }
      const playable = await createPlayableMediaObjectUrl(local, input.mimeType ?? 'video/mp4');
      if (playable) {
        return { thumbUrl: playable, fullUrl: playable, ownedThumb: playable };
      }
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
  if (input.isVideo) {
    return { thumbUrl: hostUrl, fullUrl: hostUrl, ownedThumb: null };
  }
  return finishImagePreview(hostUrl);
}

async function finishImagePreview(fullUrl: string): Promise<TranscriptPreviewUrls> {
  const limited = await createLimitedPreviewUrlFromHref(fullUrl, TRANSCRIPT_THUMB_MAX_EDGE_PX);
  return {
    thumbUrl: limited.url,
    fullUrl,
    ownedThumb: limited.owned ? limited.url : null,
  };
}
