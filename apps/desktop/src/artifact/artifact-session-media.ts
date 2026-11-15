import { useEffect, useState } from 'react';
import { countArtifactSessionMediaReferences, type ArtifactMediaBudget } from '@piwin/artifact';
import { useMediaPreviewRead } from '../media/media-preview-read-context.js';
import type { MediaPreviewReader } from '../conversation/transcript-media-preview.js';
import { resolveMediaDataUrl } from './artifact-session-media-cache.js';
import { artifactMediaCharacters, compressArtifactMedia } from './artifact-media-compression.js';

export {
  getArtifactMediaDataUrlCacheStats,
  resetArtifactMediaDataUrlCacheForTests,
  trimArtifactMediaDataUrlCache,
} from './artifact-session-media-cache.js';
export {
  ARTIFACT_MEDIA_MAX_EDGE_PX,
  ARTIFACT_MEDIA_TOTAL_BUDGET_CHARS,
} from './artifact-media-compression.js';

const EMPTY_MEDIA_URLS: ReadonlyMap<string, string> = new Map();

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

/** Resolve and fit preview copies; original vault files and shared cache entries are immutable. */
export async function resolveArtifactSessionMediaDataUrls(input: {
  source: string;
  sessionId: string | null;
  readMedia: MediaPreviewReader | null;
  budget?: ArtifactMediaBudget;
  providedDataUrls?: ReadonlyMap<string, string>;
  isStale?: () => boolean;
}): Promise<ReadonlyMap<string, string>> {
  const sessionId = input.sessionId;
  if (sessionId === null && input.providedDataUrls === undefined) return EMPTY_MEDIA_URLS;
  return compressArtifactMedia({
    source: input.source,
    ...(input.budget ? { budget: input.budget } : {}),
    ...(input.isStale ? { isStale: input.isStale } : {}),
    readDataUrl: async (assetId) => {
      const url =
        input.providedDataUrls !== undefined
          ? (input.providedDataUrls.get(assetId) ?? null)
          : sessionId === null
            ? null
            : await resolveMediaDataUrl(sessionId, assetId, input.readMedia, input.isStale);
      if (url === null) {
        console.warn('[artifact-media] image not bound: no readable vault copy', {
          sessionId,
          assetId,
          hostReader: input.readMedia !== null,
        });
      }
      return url;
    },
  });
}

/** Resolve this session's vault images within the current materialized document budget. */
export function useArtifactSessionMediaDataUrls(input: {
  source: string;
  originSessionId?: string | undefined;
  budget?: ArtifactMediaBudget | undefined;
  providedDataUrls?: ReadonlyMap<string, string> | undefined;
}): ReadonlyMap<string, string> {
  const { sessionId, readMedia } = useMediaPreviewRead();
  const boundSessionId = resolveBoundArtifactMediaSessionId({
    ...(input.originSessionId !== undefined ? { originSessionId: input.originSessionId } : {}),
    providerSessionId: sessionId,
  });
  const [resolved, setResolved] = useState({
    sessionId: boundSessionId,
    provided: input.providedDataUrls,
    budget: input.budget,
    urls:
      input.providedDataUrls &&
      (!input.budget ||
        artifactMediaCharacters(input.providedDataUrls, input.budget) <= input.budget.maxCharacters)
        ? input.providedDataUrls
        : EMPTY_MEDIA_URLS,
  });

  useEffect(() => {
    const references =
      input.budget?.references ?? countArtifactSessionMediaReferences(input.source);
    if (
      references.size === 0 ||
      (boundSessionId === null && input.providedDataUrls === undefined)
    ) {
      setResolved((current) =>
        current.urls.size === 0
          ? current
          : {
              sessionId: boundSessionId,
              provided: input.providedDataUrls,
              budget: input.budget,
              urls: EMPTY_MEDIA_URLS,
            },
      );
      return;
    }
    let cancelled = false;
    void resolveArtifactSessionMediaDataUrls({
      source: input.source,
      sessionId: boundSessionId,
      readMedia,
      ...(input.budget ? { budget: input.budget } : {}),
      ...(input.providedDataUrls !== undefined ? { providedDataUrls: input.providedDataUrls } : {}),
      isStale: () => cancelled,
    })
      .then((next) => {
        if (!cancelled) {
          setResolved((current) => {
            const sameUrls = sameMediaUrls(current.urls, next);
            if (
              current.sessionId === boundSessionId &&
              current.provided === input.providedDataUrls &&
              current.budget === input.budget &&
              sameUrls
            )
              return current;
            return {
              sessionId: boundSessionId,
              provided: input.providedDataUrls,
              budget: input.budget,
              urls: sameUrls ? current.urls : next,
            };
          });
        }
      })
      .catch((error: unknown) => {
        console.warn('[artifact-media] could not prepare preview images', error);
      });
    return () => {
      cancelled = true;
    };
  }, [input.source, input.budget, input.providedDataUrls, boundSessionId, readMedia]);

  if (resolved.sessionId !== boundSessionId || resolved.provided !== input.providedDataUrls)
    return EMPTY_MEDIA_URLS;
  if (
    input.budget &&
    resolved.budget !== input.budget &&
    artifactMediaCharacters(resolved.urls, input.budget) > input.budget.maxCharacters
  )
    return EMPTY_MEDIA_URLS;
  return resolved.urls;
}
