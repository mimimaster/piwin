/**
 * Materials library reads: one page of a source's documents, and one bounded
 * document window that can be extended.
 *
 * Both hooks keep the request function in a ref. Passing an inline
 * `(command) => props.request(command)` into an effect dependency re-fires on
 * every render and turns the reader into a request loop.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  formatError,
  type HostCommand,
  type HostResponse,
  type KnowledgeDocumentEntry,
  type KnowledgeDocumentReadResult,
} from '@piwin/contracts';
import {
  readKnowledgeDocumentList,
  readKnowledgeDocumentRead,
} from '../knowledge-base-client.js';

export type KnowledgeDocumentsRequest = (command: HostCommand) => Promise<HostResponse>;

export type KnowledgeDocumentsState = {
  items: KnowledgeDocumentEntry[];
  total: number;
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  hasMore: boolean;
  loadMore: () => Promise<void>;
  reload: () => Promise<void>;
};

/** Debounce so typing in the library filter does not re-walk the folder per key. */
const QUERY_DEBOUNCE_MS = 250;

export function useKnowledgeDocuments(args: {
  request: KnowledgeDocumentsRequest;
  enabled: boolean;
  baseId: string | null;
  query: string;
}): KnowledgeDocumentsState {
  const { baseId, enabled, query } = args;
  const requestRef = useRef(args.request);
  requestRef.current = args.request;

  const [items, setItems] = useState<KnowledgeDocumentEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [debouncedQuery, setDebouncedQuery] = useState(query);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), QUERY_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  const fetchPage = useCallback(
    async (mode: 'reload' | 'more', nextCursor?: string) => {
      if (!enabled || !baseId) {
        setItems([]);
        setTotal(0);
        setCursor(undefined);
        return;
      }
      if (mode === 'reload') setLoading(true);
      else setLoadingMore(true);
      try {
        const response = await requestRef.current({
          type: 'knowledge/documents/list',
          baseId,
          limit: 50,
          ...(nextCursor !== undefined ? { cursor: nextCursor } : {}),
          ...(debouncedQuery.trim().length > 0 ? { query: debouncedQuery.trim() } : {}),
        });
        if (!response.success) {
          setError(response.error);
          if (mode === 'reload') {
            setItems([]);
            setTotal(0);
            setCursor(undefined);
          }
          return;
        }
        const page = readKnowledgeDocumentList(response.data);
        if (!page) {
          setError('Unexpected knowledge/documents/list response');
          return;
        }
        setError(null);
        setTotal(page.total);
        setCursor(page.nextCursor);
        setItems((current) => (mode === 'reload' ? page.items : [...current, ...page.items]));
      } catch (caught) {
        setError(formatError(caught));
      } finally {
        if (mode === 'reload') setLoading(false);
        else setLoadingMore(false);
      }
    },
    [baseId, debouncedQuery, enabled],
  );

  useEffect(() => {
    void fetchPage('reload');
  }, [fetchPage]);

  const loadMore = useCallback(async () => {
    if (!cursor || loadingMore) return;
    await fetchPage('more', cursor);
  }, [cursor, fetchPage, loadingMore]);

  const reload = useCallback(async () => {
    await fetchPage('reload');
  }, [fetchPage]);

  return {
    items,
    total,
    loading,
    loadingMore,
    error,
    hasMore: cursor !== undefined,
    loadMore,
    reload,
  };
}

export type KnowledgeDocumentReadState = {
  doc: KnowledgeDocumentReadResult | null;
  /** Concatenated windows loaded so far. */
  text: string;
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  canLoadMore: boolean;
  loadMore: () => Promise<void>;
};

export function useKnowledgeDocumentRead(args: {
  request: KnowledgeDocumentsRequest;
  enabled: boolean;
  baseId: string | null;
  relativePath: string | null;
  /** Window size for the first request; the Host caps it anyway. */
  windowLines?: number;
}): KnowledgeDocumentReadState {
  const { baseId, enabled, relativePath } = args;
  const windowLines = args.windowLines ?? 400;
  const requestRef = useRef(args.request);
  requestRef.current = args.request;

  const [doc, setDoc] = useState<KnowledgeDocumentReadResult | null>(null);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const read = useCallback(
    async (startLine: number | undefined) => {
      if (!enabled || !baseId || !relativePath) return;
      if (startLine === undefined) setLoading(true);
      else setLoadingMore(true);
      try {
        const response = await requestRef.current({
          type: 'knowledge/document/read',
          baseId,
          relativePath,
          maxLines: windowLines,
          ...(startLine !== undefined ? { startLine } : {}),
        });
        if (!response.success) {
          setError(response.error);
          if (startLine === undefined) {
            setDoc(null);
            setText('');
          }
          return;
        }
        const window = readKnowledgeDocumentRead(response.data);
        if (!window) {
          setError('Unexpected knowledge/document/read response');
          return;
        }
        setError(null);
        setDoc(window);
        setText((current) =>
          startLine === undefined || current.length === 0
            ? window.text
            : `${current}\n${window.text}`,
        );
      } catch (caught) {
        setError(formatError(caught));
      } finally {
        if (startLine === undefined) setLoading(false);
        else setLoadingMore(false);
      }
    },
    [baseId, enabled, relativePath, windowLines],
  );

  useEffect(() => {
    setDoc(null);
    setText('');
    setError(null);
    void read(undefined);
  }, [read]);

  const loadMore = useCallback(async () => {
    if (!doc?.hasMore || loadingMore) return;
    await read(doc.endLine + 1);
  }, [doc, loadingMore, read]);

  return {
    doc,
    text,
    loading,
    loadingMore,
    error,
    canLoadMore: doc?.hasMore === true,
    loadMore,
  };
}
