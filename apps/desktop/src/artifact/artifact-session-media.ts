import { useEffect, useState } from 'react';
import { listArtifactSessionMediaIds } from '@piwin/artifact';
import { createLimitedDataUrlFromHref } from '../media/media-preview-bitmap';
import { useMediaPreviewRead } from '../media/media-preview-read-context';
import { releaseMediaPreviewUrl } from '../media/media-preview-url-cache';
import type { CacheBudget } from '../notes/cache-budget.js';
import { anyOwnerLive, registerDisposableCache } from '../notes/cache-budget.js';
import { desktopMetrics } from '../run-activity/diagnostic-metrics';
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
const LOCAL_VAULT_IMAGE_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
] as const;

/**
 * Decoded stills keyed by session asset. A streaming fence re-resolves on
 * every token, and decode + re-encode is far costlier than the reader's own
 * cached object URL, so repeat reads must not pay it again.
 */
const MAX_CACHED_MEDIA_DATA_URLS = 32;
const MAX_MEDIA_DATA_URL_CACHE_BYTES = 16 * 1024 * 1024;

type MediaDataUrlEntry = {
  /** Shared decode. Cache-hit callers join this same promise (lease dedup). */
  promise: Promise<string | null>;
  /** Live consumers awaiting/holding this decode; >0 entries are never evicted. */
  refs: number;
  /** Resolved while every caller was stale → returned but not counted as cached. */
  unleased: boolean;
  /** Encoded size: the data-URL string length (~chars ≈ UTF-16 bytes). */
  encodedBytes: number;
  /**
   * Decoded-pixel estimate, tracked SEPARATELY from encodedBytes: a 1024px
   * RGBA bitmap is ~4 MiB regardless of its compressed string. Dimensions are
   * not observable from a data URL without an Image, so this is a heuristic
   * (~decoded payload ×4) for diagnostics, not the trim budget.
   */
  pixelBytes: number;
  /** One staleness probe per caller that supplied one. */
  staleChecks: Set<() => boolean>;
};

const mediaDataUrlCache = new Map<string, MediaDataUrlEntry>();
let cacheMaxEntries = MAX_CACHED_MEDIA_DATA_URLS;
let cacheMaxBytes = MAX_MEDIA_DATA_URL_CACHE_BYTES;

/** Sum of encodedBytes over admitted (leased) entries — the trim budget. */
function estimateCacheBytes(): number {
  let total = 0;
  for (const entry of mediaDataUrlCache.values()) {
    if (!entry.unleased) total += entry.encodedBytes;
  }
  return total;
}

function decodedPayloadBytes(dataUrl: string): number {
  const comma = dataUrl.indexOf(',');
  if (comma < 0) return dataUrl.length;
  return Math.ceil((dataUrl.length - comma - 1) * 0.75);
}

/** ~4 bytes/px RGBA at the 1024px cap is ≈4× the compressed payload. */
function estimateDecodedPixelBytes(dataUrl: string): number {
  return decodedPayloadBytes(dataUrl) * 4;
}

function evictArtifactMediaEntry(key: string): void {
  mediaDataUrlCache.delete(key);
}

/**
 * Governor-driven trim: update caps, evict LRU-first until within them.
 * Entries with pending consumers (refs > 0) and in-flight decodes are
 * protected — evicting a promise its waiter still needs just re-decodes on
 * the next stream token. Over-budget-but-protected bytes are logged, since
 * protection is a correctness constraint, not a leak.
 */
export function trimArtifactMediaDataUrlCache(budget: CacheBudget): void {
  if (budget.maxEntries !== undefined) {
    cacheMaxEntries = budget.maxEntries;
  }
  if (budget.maxBytes !== undefined) {
    cacheMaxBytes = budget.maxBytes;
  }
  // Unleased entries (stale completions / oversized singles) go first.
  for (const [key, entry] of [...mediaDataUrlCache]) {
    if (entry.unleased && entry.refs === 0) {
      evictArtifactMediaEntry(key);
    }
  }
  if (budget.evictAll) {
    for (const [key, entry] of [...mediaDataUrlCache]) {
      if (entry.refs === 0) {
        evictArtifactMediaEntry(key);
      }
    }
    reportArtifactMediaBudgetOverflow();
    return;
  }
  let storedBytes = estimateCacheBytes();
  let storedCount = 0;
  for (const entry of mediaDataUrlCache.values()) {
    if (!entry.unleased) storedCount += 1;
  }
  for (const [key, entry] of mediaDataUrlCache) {
    if (storedCount <= cacheMaxEntries && storedBytes <= cacheMaxBytes) break;
    if (entry.refs > 0 || entry.unleased) continue;
    storedCount -= 1;
    storedBytes -= entry.encodedBytes;
    evictArtifactMediaEntry(key);
  }
  reportArtifactMediaBudgetOverflow();
}

function reportArtifactMediaBudgetOverflow(): void {
  const storedBytes = estimateCacheBytes();
  if (storedBytes <= cacheMaxBytes) return;
  let protectedCount = 0;
  for (const entry of mediaDataUrlCache.values()) {
    if (!entry.unleased && entry.refs > 0) protectedCount += 1;
  }
  // Over budget only because protected (live-consumer) entries cannot be
  // evicted — a correctness constraint, not a leak. Record it, don't evict.
  console.warn('[artifact-media] cache over budget; leased entries kept', {
    storedBytes,
    budget: cacheMaxBytes,
    protectedEntries: protectedCount,
  });
}

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
  isStale?: () => boolean,
): Promise<string | null> {
  const key = `${sessionId}:${assetId}`;
  const cached = mediaDataUrlCache.get(key);
  if (cached !== undefined) {
    mediaDataUrlCache.delete(key);
    mediaDataUrlCache.set(key, cached);
    cached.refs += 1;
    if (isStale !== undefined) cached.staleChecks.add(isStale);
    return cached.promise.finally(() => {
      cached.refs = Math.max(0, cached.refs - 1);
    });
  }
  const staleChecks = new Set<() => boolean>();
  if (isStale !== undefined) staleChecks.add(isStale);
  const entry: MediaDataUrlEntry = {
    promise: Promise.resolve(null),
    refs: 1,
    unleased: false,
    encodedBytes: 0,
    pixelBytes: 0,
    staleChecks,
  };
  entry.promise = (async () => {
    const local = await decodeLocalVaultImage(sessionId, assetId);
    if (local !== null || readMedia === null) return local;
    return decodeHostVaultImage(sessionId, assetId, readMedia);
  })()
    .then((url) => {
      // A failed read may be transient; let the next resolve try again.
      if (url === null) {
        if (mediaDataUrlCache.get(key) === entry) mediaDataUrlCache.delete(key);
        return url;
      }
      entry.encodedBytes = url.length;
      entry.pixelBytes = estimateDecodedPixelBytes(url);
      // Generation guard: if every caller turned stale before the decode
      // finished, hand the value back but do NOT admit it into the shared
      // cache — the entry is unlinked now so it can neither serve hits nor
      // outlive a trim.
      // Admission: a single entry larger than the budget is likewise never
      // stored (no evict-all-then-admit).
      if (!anyOwnerLive(staleChecks) || cacheMaxEntries <= 0 || url.length > cacheMaxBytes) {
        entry.unleased = true;
        if (mediaDataUrlCache.get(key) === entry) mediaDataUrlCache.delete(key);
        return url;
      }
      trimArtifactMediaDataUrlCache({});
      return url;
    })
    .catch((error: unknown) => {
      if (mediaDataUrlCache.get(key) === entry) mediaDataUrlCache.delete(key);
      throw error;
    });
  mediaDataUrlCache.set(key, entry);
  trimArtifactMediaDataUrlCache({});
  return entry.promise.finally(() => {
    entry.refs = Math.max(0, entry.refs - 1);
  });
}

export function resetArtifactMediaDataUrlCacheForTests(): void {
  mediaDataUrlCache.clear();
  cacheMaxEntries = MAX_CACHED_MEDIA_DATA_URLS;
  cacheMaxBytes = MAX_MEDIA_DATA_URL_CACHE_BYTES;
}

/**
 * Entry and byte counters for diagnostics. `encodedBytes` is what the trim
 * budget charges; `pixelBytes` is the heavier decoded estimate tracked
 * alongside (see MediaDataUrlEntry).
 */
export function getArtifactMediaDataUrlCacheStats(): {
  entries: number;
  encodedBytes: number;
  pixelBytes: number;
  protectedEntries: number;
} {
  let encodedBytes = 0;
  let pixelBytes = 0;
  let protectedEntries = 0;
  for (const entry of mediaDataUrlCache.values()) {
    if (entry.unleased) continue;
    encodedBytes += entry.encodedBytes;
    pixelBytes += entry.pixelBytes;
    if (entry.refs > 0) protectedEntries += 1;
  }
  return { entries: mediaDataUrlCache.size, encodedBytes, pixelBytes, protectedEntries };
}

registerDisposableCache({
  name: 'artifactMediaDataUrls',
  applyBudget: trimArtifactMediaDataUrlCache,
});

desktopMetrics.registerCacheProvider('artifactMediaDataUrls', () => {
  const stats = getArtifactMediaDataUrlCacheStats();
  return { entries: stats.entries, bytes: stats.encodedBytes };
});

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
    if (input.providerSessionId !== null && input.originSessionId !== input.providerSessionId) {
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
  /**
   * Generation/visibility probe for the generation-guard: when it flips true
   * before a decode settles (caller unmounted, source replaced), that decode
   * is returned to the caller but never admitted to the shared cache.
   */
  isStale?: () => boolean;
}): Promise<ReadonlyMap<string, string>> {
  const mediaIds = listArtifactSessionMediaIds(input.source);
  const sessionId = input.sessionId;
  if (mediaIds.length === 0 || sessionId === null) {
    return EMPTY_MEDIA_URLS;
  }
  const entries = await Promise.all(
    mediaIds.map(
      async (assetId) =>
        [
          assetId,
          await resolveMediaDataUrl(sessionId, assetId, input.readMedia, input.isStale),
        ] as const,
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
      isStale: () => cancelled,
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
