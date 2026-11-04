/**
 * Paged `media/list` for the phone library.
 *
 * The Host owns the catalog: kind and search text are asked for, never
 * filtered locally. Every asynchronous branch is generation-guarded so a slow
 * page can never overwrite a newer tab, query or reconnect.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { HostClient } from '@piwin/host-client';
import type { MediaLibraryItem } from '@piwin/contracts';
import {
  kindForLibraryTab,
  LIBRARY_PAGE_SIZE,
  mapLibraryError,
  mergeLibraryItems,
  readLibraryPage,
  type LibraryTab,
} from './library-model.js';

const SEARCH_DEBOUNCE_MS = 250;

export type MediaLibrarySnapshot = {
  items: MediaLibraryItem[];
  /** Host count for the current kind + query. */
  total: number;
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  error: string | undefined;
  /** The Host answered but has no `media/list` (older build). Not an error to retry. */
  unsupported: boolean;
  loadMore: () => void;
  reload: () => void;
};

type LibraryState = {
  items: MediaLibraryItem[];
  total: number;
  cursor: string | undefined;
  loading: boolean;
  loadingMore: boolean;
  error: string | undefined;
  unsupported: boolean;
};

const EMPTY_STATE: LibraryState = {
  items: [],
  total: 0,
  cursor: undefined,
  loading: true,
  loadingMore: false,
  error: undefined,
  unsupported: false,
};

export function useMediaLibrary(args: {
  client: HostClient | undefined;
  ready: boolean;
  tab: LibraryTab;
  query: string;
}): MediaLibrarySnapshot {
  const { client, ready, tab } = args;
  const query = args.query.trim();
  const [debouncedQuery, setDebouncedQuery] = useState(query);

  useEffect(() => {
    if (query === debouncedQuery) return undefined;
    const timer = setTimeout(() => setDebouncedQuery(query), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, debouncedQuery]);

  const [state, setState] = useState<LibraryState>(EMPTY_STATE);
  const [reloadNonce, setReloadNonce] = useState(0);
  const generationRef = useRef(0);
  const busyRef = useRef(false);
  const cursorRef = useRef<string | undefined>(undefined);
  const seenCursorsRef = useRef<Set<string>>(new Set());
  const supported = client !== undefined && client.supportsCommand('media/list');

  useEffect(() => {
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    cursorRef.current = undefined;
    seenCursorsRef.current = new Set();
    busyRef.current = false;

    if (client === undefined || !supported) {
      setState({ ...EMPTY_STATE, loading: false, unsupported: client !== undefined });
      return undefined;
    }
    if (!ready) {
      // Reconnecting: keep whatever the last live read showed, but do not
      // present it as current while the Host is silent.
      setState((previous) => ({
        ...previous,
        loading: previous.items.length === 0,
        loadingMore: false,
      }));
      return undefined;
    }

    let cancelled = false;
    const owned = (): boolean => !cancelled && generationRef.current === generation;
    const kind = kindForLibraryTab(tab);
    busyRef.current = true;
    setState((previous) => ({ ...previous, loading: true, loadingMore: false, error: undefined }));

    void (async () => {
      try {
        const response = await client.request({
          type: 'media/list',
          input: {
            limit: LIBRARY_PAGE_SIZE,
            ...(kind === undefined ? {} : { kind }),
            ...(debouncedQuery.length === 0 ? {} : { query: debouncedQuery }),
          },
        });
        if (!owned()) return;
        const parsed = readLibraryPage(response);
        if (!parsed.ok) {
          setState({
            items: [],
            total: 0,
            cursor: undefined,
            loading: false,
            loadingMore: false,
            error: parsed.error,
            unsupported: false,
          });
          return;
        }
        const next = parsed.page.nextCursor;
        cursorRef.current = next;
        if (next !== undefined) seenCursorsRef.current.add(next);
        setState({
          items: parsed.page.items,
          total: parsed.page.total,
          cursor: next,
          loading: false,
          loadingMore: false,
          error: undefined,
          unsupported: false,
        });
      } catch (error) {
        if (!owned()) return;
        setState({
          items: [],
          total: 0,
          cursor: undefined,
          loading: false,
          loadingMore: false,
          error: mapLibraryError(error instanceof Error ? error.message : '读取资料库失败。'),
          unsupported: false,
        });
      } finally {
        if (owned()) busyRef.current = false;
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [client, supported, ready, tab, debouncedQuery, reloadNonce]);

  const loadMore = useCallback(() => {
    const cursor = cursorRef.current;
    if (client === undefined || cursor === undefined || busyRef.current) return;
    const generation = generationRef.current;
    const kind = kindForLibraryTab(tab);
    busyRef.current = true;
    setState((previous) => ({ ...previous, loadingMore: true }));

    void (async () => {
      try {
        const response = await client.request({
          type: 'media/list',
          input: {
            limit: LIBRARY_PAGE_SIZE,
            cursor,
            ...(kind === undefined ? {} : { kind }),
            ...(debouncedQuery.length === 0 ? {} : { query: debouncedQuery }),
          },
        });
        if (generationRef.current !== generation) return;
        const parsed = readLibraryPage(response);
        if (!parsed.ok) {
          setState((previous) => ({ ...previous, loadingMore: false, error: parsed.error }));
          return;
        }
        const next = parsed.page.nextCursor;
        if (next !== undefined && seenCursorsRef.current.has(next)) {
          // A repeated cursor would page forever; stop instead of spinning.
          cursorRef.current = undefined;
          setState((previous) => ({
            ...previous,
            items: mergeLibraryItems(previous.items, parsed.page.items),
            loadingMore: false,
            cursor: undefined,
          }));
          return;
        }
        if (next !== undefined) seenCursorsRef.current.add(next);
        cursorRef.current = next;
        setState((previous) => ({
          ...previous,
          items: mergeLibraryItems(previous.items, parsed.page.items),
          total: Math.max(previous.total, parsed.page.total),
          cursor: next,
          loadingMore: false,
          error: undefined,
        }));
      } catch (error) {
        if (generationRef.current !== generation) return;
        setState((previous) => ({
          ...previous,
          loadingMore: false,
          error: mapLibraryError(error instanceof Error ? error.message : '读取资料库失败。'),
        }));
      } finally {
        if (generationRef.current === generation) busyRef.current = false;
      }
    })();
  }, [client, tab, debouncedQuery]);

  const reload = useCallback(() => {
    setReloadNonce((nonce) => nonce + 1);
  }, []);

  return {
    items: state.items,
    total: state.total,
    loading: state.loading,
    loadingMore: state.loadingMore,
    hasMore: state.cursor !== undefined,
    error: state.error,
    unsupported: state.unsupported,
    loadMore,
    reload,
  };
}
