import { useEffect, useState } from 'react';
import { listArtifactSessionMediaIds } from '@piwin/artifact';
import { createLimitedDataUrlFromHref } from './media-preview-bitmap';
import { useMediaPreviewRead } from './media-preview-read-context';
import type { MediaPreviewReader } from './transcript-media-preview';

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
 * Decoded stills keyed by session asset. A streaming fence re-resolves on
 * every token, and decode + re-encode is far costlier than the reader's own
 * cached object URL, so repeat reads must not pay it again.
 */
const MAX_CACHED_MEDIA_DATA_URLS = 32;
const mediaDataUrlCache = new Map<string, Promise<string | null>>();

function decodeMediaDataUrl(key: string, href: string): Promise<string | null> {
  const cached = mediaDataUrlCache.get(key);
  if (cached !== undefined) {
    mediaDataUrlCache.delete(key);
    mediaDataUrlCache.set(key, cached);
    return cached;
  }
  const pending = createLimitedDataUrlFromHref(href, ARTIFACT_MEDIA_MAX_EDGE_PX).then((url) => {
    // A failed decode may be transient; let the next resolve try again.
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
 * Read this artifact's vault ids and return size-capped `data:` images.
 * Ids that cannot be read, decoded, or that exceed the per-artifact budget are
 * left out; `bindArtifactSessionMedia` then renders that `<img>` without a src
 * rather than inventing one.
 */
export async function resolveArtifactSessionMediaDataUrls(input: {
  source: string;
  sessionId: string | null;
  readMedia: MediaPreviewReader | null;
}): Promise<ReadonlyMap<string, string>> {
  const mediaIds = listArtifactSessionMediaIds(input.source);
  const sessionId = input.sessionId;
  const readMedia = input.readMedia;
  if (mediaIds.length === 0 || sessionId === null || readMedia === null) {
    return EMPTY_MEDIA_URLS;
  }
  const entries = await Promise.all(
    mediaIds.map(async (assetId) => {
      const href = await readMedia({ sessionId, assetId });
      if (typeof href !== 'string' || !href.startsWith('blob:')) {
        return [assetId, null] as const;
      }
      return [assetId, await decodeMediaDataUrl(`${sessionId}:${assetId}`, href)] as const;
    }),
  );
  const urls = new Map<string, string>();
  let budget = ARTIFACT_MEDIA_TOTAL_BUDGET_CHARS;
  for (const [assetId, url] of entries) {
    if (url === null || !url.startsWith('data:image/')) {
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
    if (mediaIds.length === 0 || boundSessionId === null || readMedia === null) {
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
