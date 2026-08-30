import { useEffect, useState } from 'react';
import type { MediaLibraryItem } from '@piwin/contracts';
import { createPlayableMediaObjectUrl } from '../../playable-media-url';
import { readLibraryMediaViaHost, type MediaLibraryHost } from './media-library-src';

export function usePlayableLibrarySrc(input: {
  item: Pick<MediaLibraryItem, 'kind' | 'mimeType' | 'sessionId' | 'assetId'>;
  localSrc: string;
  request: MediaLibraryHost['request'];
  enabled?: boolean;
}): string {
  const [src, setSrc] = useState('');
  const enabled = input.enabled !== false;
  const { kind, mimeType, sessionId, assetId } = input.item;
  const { localSrc, request } = input;

  useEffect(() => {
    if (!enabled) {
      setSrc('');
      return;
    }
    let cancelled = false;
    let owned: string | null = null;
    void (async () => {
      if (localSrc && kind === 'video') {
        const playable = await createPlayableMediaObjectUrl(localSrc, mimeType);
        if (cancelled) {
          if (playable) URL.revokeObjectURL(playable);
          return;
        }
        if (playable) {
          owned = playable;
          setSrc(playable);
          return;
        }
      }
      if (localSrc) {
        if (!cancelled) setSrc(localSrc);
        return;
      }
      if (kind === 'video') {
        if (!cancelled) setSrc('');
        return;
      }
      const hostUrl = await readLibraryMediaViaHost(
        { request },
        { sessionId, assetId, variant: 'full' },
      );
      if (cancelled) {
        if (hostUrl) URL.revokeObjectURL(hostUrl);
        return;
      }
      owned = hostUrl;
      if (hostUrl) setSrc(hostUrl);
    })();
    return () => {
      cancelled = true;
      if (owned) URL.revokeObjectURL(owned);
    };
  }, [enabled, kind, mimeType, sessionId, assetId, localSrc, request]);

  return src;
}
