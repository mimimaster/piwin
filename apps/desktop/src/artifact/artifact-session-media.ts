import { useEffect, useState } from 'react';
import { listArtifactSessionMediaIds } from '@piwin/artifact';
import { createLimitedDataUrlFromHref } from '../media/media-preview-bitmap';
import { useMediaPreviewRead } from '../media/media-preview-read-context';
import { releaseMediaPreviewUrl } from '../media/media-preview-url-cache';
import {
  resolveLocalVaultMediaUrl,
  type MediaPreviewReader,
} from '../conversation/transcript-media-preview';

const EMPTY_MEDIA_URLS: ReadonlyMap<string, string> = new Map();

/**
 * Artifact images must be `data:` URLs: the sandbox iframe has an opaque
 * origin, so a host-origin `blob:` src errors instead of painting. Capping the
 * decode keeps that inlined copy — which is base64'd again into the frame's
 * document URL — from dwarfing the artifact itself.
 */
export const ARTIFACT_MEDIA_MAX_EDGE_PX = 1024;
/** Total inlined image budget per artifact, in data-URL characters. */
export const ARTIFACT_MEDIA_TOTAL_BUDGET_CHARS = 6 * 1024 * 1024;

/**
 * The vault file name carries the extension of its mime type, which the
 * artifact does not know. Generated stills are JPEG/PNG/WebP; GIF is rare.
 */
const LOCAL_VAULT_IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const;

/**
 * Decoded stills keyed by session asset. A streaming fence re-resolves on
 * every token, and decode + re-encode is far costlier than the reader's own
 * cached object URL, so repeat reads must not pay it again.
 */
const MAX_CACHED_MEDIA_DATA_URLS = 32;
const mediaDataUrlCache = new Map<string, Promise<string | null>>();

/**
 * Same route the transcript hero takes first: the shell reads the vault file
 * directly. A miss (remote Host, other extension) costs one failed asset load.
 */
async function decodeLocalVaultImage(sessionId: string, assetId: string): Promise<string | null> {
  for (const mimeType of LOCAL_VAULT_IMAGE_MIME_TYPES) {
    const href = await resolveLocalVaultMediaUrl({ sessionId, assetId, mimeType });
    // No local file access in this shell at all; trying more extensions is moot.
    if (href === null) return null;
    const url = await createLimitedDataUrlFromHref(href, ARTIFACT_MEDIA_MAX_EDGE_PX);
    if (url !== null) return url;
  }
  return null;
}

async function decodeHostVaultImage(
  sessionId: string,
  assetId: string,
  readMedia: MediaPreviewReader,
): Promise<string | null> {
  const href = await readMedia({ sessionId, assetId });
  try {
    if (typeof href !== 'string' || !href.startsWith('blob:')) {
      return null;
    }
    return await createLimitedDataUrlFromHref(href, ARTIFACT_MEDIA_MAX_EDGE_PX);
  } finally {
    // The artifact keeps the decoded data URL, not the reader's object URL.
    releaseMediaPreviewUrl(href);
  }
}

function resolveMediaDataUrl(
  sessionId: string,
  assetId: string,
  readMedia: MediaPreviewReader | null,
): Promise<string | null> {
  const key = `${sessionId}:${assetId}`;
  const cached = mediaDataUrlCache.get(key);
  if (cached !== undefined) {
    mediaDataUrlCache.delete(key);
    mediaDataUrlCache.set(key, cached);
    return cached;
  }
  const pending = (async () => {
    const local = await decodeLocalVaultImage(sessionId, assetId);
    if (local !== null || readMedia === null) return local;
    return decodeHostVaultImage(sessionId, assetId, readMedia);
  })().then((url) => {
    // A failed read may be transient; let the next resolve try again.
    if (url === null) mediaDataUrlCache.delete(key);
    return url;
  });
  mediaDataUrlCache.set(key, pending);
  if (mediaDataUrlCache.size > MAX_CACHED_MEDIA_DATA_URLS) {
    const oldest = mediaDataUrlCache.keys().next().value;
    if (oldest !== undefined) mediaDataUrlCache.delete(oldest);
  }
  return pending;
}

export function resetArtifactMediaDataUrlCacheForTests(): void {
  mediaDataUrlCache.clear();
}

function sameMediaUrls(a: ReadonlyMap<string, string>, b: ReadonlyMap<string, string>): boolean {
  if (a.size !== b.size) return false;
  for (const [key, value] of a) {
    if (b.get(key) !== value) return false;
  }
  return true;
}

/** Bind only this session's vault. Other-session / fork ids stay unbound. */
export function resolveBoundArtifactMediaSessionId(input: {
  originSessionId?: string | undefined;
  providerSessionId: string | null;
}): string | null {
  if (input.originSessionId !== undefined) {
    if (
      input.providerSessionId !== null &&
      input.originSessionId !== input.providerSessionId
    ) {
      return null;
    }
    return input.originSessionId;
  }
  return input.providerSessionId;
}


/**
 * Read this artifact's vault ids and return size-capped `data:` images: the
 * local vault file first, then Host `media/read`. Ids that cannot be read,
 * decoded, or that exceed the per-artifact budget are left out;
 * `bindArtifactSessionMedia` then renders that `<img>` without a src rather
 * than inventing one.
 */
export async function resolveArtifactSessionMediaDataUrls(input: {
  source: string;
  sessionId: string | null;
  readMedia: MediaPreviewReader | null;
}): Promise<ReadonlyMap<string, string>> {
  const mediaIds = listArtifactSessionMediaIds(input.source);
  const sessionId = input.sessionId;
  if (mediaIds.length === 0 || sessionId === null) {
    return EMPTY_MEDIA_URLS;
  }
  const entries = await Promise.all(
    mediaIds.map(
      async (assetId) =>
        [assetId, await resolveMediaDataUrl(sessionId, assetId, input.readMedia)] as const,
    ),
  );
  const urls = new Map<string, string>();
  let budget = ARTIFACT_MEDIA_TOTAL_BUDGET_CHARS;
  for (const [assetId, url] of entries) {
    if (url === null || !url.startsWith('data:image/')) {
      console.warn('[artifact-media] image not bound: no readable vault copy', {
        sessionId,
        assetId,
        hostReader: input.readMedia !== null,
      });
      continue;
    }
    if (url.length > budget) {
      console.warn('[artifact-media] image skipped: over the per-artifact inline budget', {
        assetId,
        chars: url.length,
      });
      continue;
    }
    budget -= url.length;
    urls.set(assetId, url);
  }
  return urls;
}

/** Resolve this session's vault images referenced by data-piwin-media. */
export function useArtifactSessionMediaDataUrls(input: {
  source: string;
  originSessionId?: string | undefined;
}): ReadonlyMap<string, string> {
  const { sessionId, readMedia } = useMediaPreviewRead();
  const boundSessionId = resolveBoundArtifactMediaSessionId({
    ...(input.originSessionId !== undefined ? { originSessionId: input.originSessionId } : {}),
    providerSessionId: sessionId,
  });
  const [urls, setUrls] = useState<ReadonlyMap<string, string>>(EMPTY_MEDIA_URLS);

  useEffect(() => {
    const mediaIds = listArtifactSessionMediaIds(input.source);
    if (mediaIds.length === 0 || boundSessionId === null) {
      setUrls((current) => (current.size === 0 ? current : EMPTY_MEDIA_URLS));
      return;
    }
    let cancelled = false;
    void resolveArtifactSessionMediaDataUrls({
      source: input.source,
      sessionId: boundSessionId,
      readMedia,
    }).then((next) => {
      if (!cancelled) {
        // Keep the reference stable so an unchanged binding does not
        // re-materialize the artifact on every streamed token.
        setUrls((current) => (sameMediaUrls(current, next) ? current : next));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [input.source, boundSessionId, readMedia]);

  return urls;
}
