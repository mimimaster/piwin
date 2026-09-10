import { useCallback, useEffect, useRef, useState } from 'react';
import type { HostCommand, HostResponse, MediaLibraryItem, MediaLibraryKind } from '@piwin/contracts';

export type MediaLibraryRequest = (command: HostCommand) => Promise<HostResponse>;

export type MediaLibraryFilter = MediaLibraryKind | 'all';

export type UseMediaLibraryArgs = {
  kind: MediaLibraryFilter;
  request: MediaLibraryRequest;
  query: string;
  refreshToken: number;
  isZh?: boolean;
};

export type MediaLibraryState = {
  items: MediaLibraryItem[];
  total: number;
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  hasMore: boolean;
  loadMore: () => void;
  deleteAsset: (item: Pick<MediaLibraryItem, 'sessionId' | 'assetId'>) => Promise<boolean>;
};

const PAGE_SIZE = 40;

export function useMediaLibrary(args: UseMediaLibraryArgs): MediaLibraryState {
  const [items, setItems] = useState<MediaLibraryItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const requestRef = useRef(args.request);
  requestRef.current = args.request;
  const fetchGen = useRef(0);

  useEffect(() => {
    const generation = ++fetchGen.current;
    const handle = window.setTimeout(() => {
      void (async () => {
        setLoading(true);
        setError(null);
        try {
          const response = await requestRef.current({
            type: 'media/list',
            input: {
              limit: PAGE_SIZE,
              ...(args.kind === 'all' ? {} : { kind: args.kind }),
              ...(args.query.trim() ? { query: args.query.trim() } : {}),
            },
          });
          if (generation !== fetchGen.current) {
            return;
          }
          if (!response.success) {
            setItems([]);
            setTotal(0);
            setCursor(undefined);
            setError(hostNeedsRestart(response.error, args.isZh === true));
            return;
          }
          const data = readListData(response.data);
          setItems(data.items);
          setTotal(data.total);
          setCursor(data.nextCursor);
        } catch (caught) {
          if (generation !== fetchGen.current) {
            return;
          }
          setItems([]);
          setTotal(0);
          setCursor(undefined);
          setError(caught instanceof Error ? caught.message : 'media/list failed');
        } finally {
          if (generation === fetchGen.current) {
            setLoading(false);
          }
        }
      })();
    }, 200);
    return () => {
      window.clearTimeout(handle);
    };
  }, [args.kind, args.query, args.refreshToken, args.isZh]);

  const loadMore = useCallback(() => {
    if (!cursor || loading || loadingMore) {
      return;
    }
    const generation = fetchGen.current;
    setLoadingMore(true);
    void requestRef
      .current({
        type: 'media/list',
        input: {
          limit: PAGE_SIZE,
          cursor,
          ...(args.kind === 'all' ? {} : { kind: args.kind }),
          ...(args.query.trim() ? { query: args.query.trim() } : {}),
        },
      })
      .then((response) => {
        if (generation !== fetchGen.current) {
          return;
        }
        if (!response.success) {
          setError(hostNeedsRestart(response.error, args.isZh === true));
          return;
        }
        const data = readListData(response.data);
        setItems((prev) => mergeItems(prev, data.items));
        setTotal(data.total);
        setCursor(data.nextCursor);
      })
      .catch((caught: unknown) => {
        if (generation !== fetchGen.current) {
          return;
        }
        setError(caught instanceof Error ? caught.message : 'media/list failed');
      })
      .finally(() => {
        if (generation === fetchGen.current) {
          setLoadingMore(false);
        }
      });
  }, [args.kind, args.query, args.isZh, cursor, loading, loadingMore]);

  const deleteAsset = useCallback(
    async (item: Pick<MediaLibraryItem, 'sessionId' | 'assetId'>): Promise<boolean> => {
      try {
        const response = await requestRef.current({
          type: 'media/delete',
          input: { sessionId: item.sessionId, assetId: item.assetId },
        });
        if (!response.success) {
          setError(hostNeedsRestart(response.error, args.isZh === true));
          return false;
        }
        setItems((prev) =>
          prev.filter(
            (entry) =>
              !(entry.sessionId === item.sessionId && entry.assetId === item.assetId),
          ),
        );
        setTotal((prev) => Math.max(0, prev - 1));
        return true;
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'media/delete failed');
        return false;
      }
    },
    [args.isZh],
  );

  return {
    items,
    total,
    loading,
    loadingMore,
    error,
    hasMore: cursor !== undefined,
    loadMore,
    deleteAsset,
  };
}

function hostNeedsRestart(error: string, isZh: boolean): string {
  if (error === 'Unhandled command') {
    return isZh
      ? 'Host 还是旧进程。请完全退出桌面应用再打开，不要只刷新窗口。'
      : 'The Host is still the old process. Fully quit and reopen the desktop app — a window refresh is not enough.';
  }
  if (error === 'Remote command payload was rejected: media/list') {
    return isZh
      ? '远程 Host 还不支持资料库（media/list）。请更新并重启 Host，再重新连接。'
      : "The remote Host doesn't support the library yet (media/list). Update and restart the Host, then reconnect.";
  }
  if (error.startsWith('Remote command payload was rejected:')) {
    return isZh
      ? '远程 Host 拒绝了资料库请求。请更新 Host 到最新版本后重试。'
      : 'The remote Host rejected the library request. Update the Host to the latest version and retry.';
  }
  return error;
}

function readListData(data: unknown): {
  items: MediaLibraryItem[];
  total: number;
  nextCursor?: string;
} {
  if (typeof data !== 'object' || data === null) {
    return { items: [], total: 0 };
  }
  const record = data as Record<string, unknown>;
  const items = Array.isArray(record.items)
    ? record.items.filter(isLibraryItem)
    : [];
  const result: { items: MediaLibraryItem[]; total: number; nextCursor?: string } = {
    items,
    total: typeof record.total === 'number' ? record.total : items.length,
  };
  if (typeof record.nextCursor === 'string' && record.nextCursor.length > 0) {
    result.nextCursor = record.nextCursor;
  }
  return result;
}

function isLibraryItem(value: unknown): value is MediaLibraryItem {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const item = value as Record<string, unknown>;
  return (
    typeof item.assetId === 'string' &&
    typeof item.sessionId === 'string' &&
    typeof item.mimeType === 'string' &&
    typeof item.createdAt === 'string' &&
    (item.kind === 'image' || item.kind === 'video' || item.kind === 'file')
  );
}

function mergeItems(
  current: readonly MediaLibraryItem[],
  incoming: readonly MediaLibraryItem[],
): MediaLibraryItem[] {
  const seen = new Set(current.map((item) => `${item.sessionId}:${item.assetId}`));
  const next = [...current];
  for (const item of incoming) {
    const key = `${item.sessionId}:${item.assetId}`;
    if (!seen.has(key)) {
      seen.add(key);
      next.push(item);
    }
  }
  return next;
}
