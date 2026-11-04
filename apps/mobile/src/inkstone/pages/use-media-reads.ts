/**
 * Lazy, budgeted media bytes for library tiles and the viewer.
 *
 * A tile only asks for its thumb once it is near the viewport, and a viewer
 * asks for the original (or says why it cannot). Nothing here caches outside
 * the module, so a reload starts from an empty cache.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { MediaLibraryItem } from '@piwin/contracts';
import type { HostClient } from '@piwin/host-client';
import {
  describeLibraryMediaUnavailable,
  libraryThumbKey,
  peekLibraryThumb,
  readLibraryFull,
  readLibraryThumb,
} from './library-reads.js';

const THUMB_PREFETCH_MARGIN = '240px 0px';

export type LibraryThumb = {
  attachRef: (node: HTMLElement | null) => void;
  src: string | undefined;
  loading: boolean;
};

export function useLibraryThumb(
  client: HostClient | undefined,
  item: MediaLibraryItem,
): LibraryThumb {
  const key = libraryThumbKey(item);
  const [node, setNode] = useState<HTMLElement | null>(null);
  const [visible, setVisible] = useState(false);
  const [src, setSrc] = useState<string | undefined>(() => peekLibraryThumb(item));
  const [loading, setLoading] = useState(false);
  const itemRef = useRef(item);
  itemRef.current = item;

  useEffect(() => {
    if (node === null) return undefined;
    if (typeof IntersectionObserver !== 'function') {
      setVisible(true);
      return undefined;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        setVisible(true);
        observer.disconnect();
      },
      { rootMargin: THUMB_PREFETCH_MARGIN },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [node]);

  useEffect(() => {
    const cached = peekLibraryThumb(itemRef.current);
    setSrc(cached);
    if (!visible || cached !== undefined) return undefined;
    let alive = true;
    setLoading(true);
    void readLibraryThumb(client, itemRef.current).then((result) => {
      if (!alive) return;
      setSrc(result.status === 'ready' ? result.src : undefined);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [visible, client, key]);

  const attachRef = useCallback((next: HTMLElement | null) => {
    setNode(next);
  }, []);

  return { attachRef, src, loading };
}

export type LibraryFullMedia = {
  src: string | undefined;
  note: string | undefined;
  loading: boolean;
};

/** Full-size preview for one item, or the reason the phone cannot show it. */
export function useLibraryFullMedia(
  client: HostClient | undefined,
  item: MediaLibraryItem | null,
): LibraryFullMedia {
  const key = item === null ? null : `${item.sessionId}:${item.assetId}:full`;
  const [media, setMedia] = useState<{ key: string | null; src: string | undefined; note: string | undefined; loading: boolean }>(
    { key: null, src: undefined, note: undefined, loading: false },
  );
  const itemRef = useRef(item);
  itemRef.current = item;

  useEffect(() => {
    if (key === null) {
      setMedia({ key: null, src: undefined, note: undefined, loading: false });
      return undefined;
    }
    const target = itemRef.current;
    if (target === null) return undefined;
    let alive = true;
    setMedia({ key, src: undefined, note: undefined, loading: true });
    void readLibraryFull(client, target).then((result) => {
      if (!alive) return;
      setMedia({
        key,
        src: result.status === 'ready' ? result.src : undefined,
        note: result.status === 'ready' ? undefined : describeLibraryMediaUnavailable(result.reason),
        loading: false,
      });
    });
    return () => {
      alive = false;
    };
  }, [key, client]);

  // A different item must not flash the previous picture while its own bytes load.
  if (media.key !== key) return { src: undefined, note: undefined, loading: key !== null };
  return { src: media.src, note: media.note, loading: media.loading };
}
