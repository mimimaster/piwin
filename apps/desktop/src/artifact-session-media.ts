import { useEffect, useState } from 'react';
import { listArtifactSessionMediaIds } from '@piwin/artifact';
import { useMediaPreviewRead } from './media-preview-read-context';
import type { MediaPreviewReader } from './transcript-media-preview';

const EMPTY_MEDIA_URLS: ReadonlyMap<string, string> = new Map();

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


export async function resolveArtifactSessionMediaObjectUrls(input: {
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
      const url = await readMedia({ sessionId, assetId });
      return [assetId, url] as const;
    }),
  );
  const urls = new Map<string, string>();
  for (const [assetId, url] of entries) {
    if (typeof url === 'string' && url.startsWith('blob:')) {
      urls.set(assetId, url);
    }
  }
  return urls;
}

/** Resolve this session's vault images referenced by data-piwin-media. */
export function useArtifactSessionMediaObjectUrls(input: {
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
    void resolveArtifactSessionMediaObjectUrls({
      source: input.source,
      sessionId: boundSessionId,
      readMedia,
    }).then((next) => {
      if (!cancelled) {
        setUrls(next);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [input.source, boundSessionId, readMedia]);

  return urls;
}
