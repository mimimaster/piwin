import { useEffect, useState } from 'react';
import type {
  FlashcardStudyCatalogPage,
  HostCommand,
  HostResponse,
  KnowledgeBaseSummary,
  KnowledgeDocumentListResult,
  KnowledgeSearchResult,
} from '@piwin/contracts';
import {
  mergeWorkspaceSearchHits,
  type TitleMatch,
  type WorkspaceSearchPage,
} from './knowledge-workspace-search.js';

export type KnowledgeWorkspaceSearchState = {
  page: WorkspaceSearchPage | null;
  loading: boolean;
  error: string | null;
};

export function useKnowledgeWorkspaceSearch(args: {
  request: (command: HostCommand) => Promise<HostResponse>;
  query: string;
  enabled: boolean;
  bases: readonly KnowledgeBaseSummary[];
}): KnowledgeWorkspaceSearchState {
  const query = args.query.trim();
  const [page, setPage] = useState<WorkspaceSearchPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!args.enabled || query.length === 0) {
      setPage(null);
      setLoading(false);
      setError(null);
      return undefined;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    const request = args.request;
    const bases = args.bases;

    void (async () => {
      try {
        const searchResponse = await request({ type: 'knowledge/search', query, limit: 12 });
        if (!searchResponse.success) {
          if (!cancelled) {
            setError(searchResponse.error);
            setPage(null);
            setLoading(false);
          }
          return;
        }
        const search = searchResponse.data as KnowledgeSearchResult;
        const catalogResponse = await request({
          type: 'flashcards/study/catalog',
          query,
          limit: 8,
          scopeFilter: { kind: 'all' },
        });
        const catalog = catalogResponse.success
          ? (catalogResponse.data as FlashcardStudyCatalogPage)
          : null;
        const titleMatches = await collectTitleMatches(request, bases, search, query);
        if (cancelled) return;
        setPage(mergeWorkspaceSearchHits({ query, search, catalog, titleMatches }));
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setPage(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [args.enabled, args.request, args.bases, query]);

  return { page, loading, error };
}

async function collectTitleMatches(
  request: (command: HostCommand) => Promise<HostResponse>,
  bases: readonly KnowledgeBaseSummary[],
  search: KnowledgeSearchResult,
  query: string,
): Promise<TitleMatch[]> {
  const skipped = new Set(
    search.skipped
      .filter((entry) => entry.reason === 'not-indexed' || entry.reason === 'indexing')
      .map((entry) => entry.baseId),
  );
  const matches: TitleMatch[] = [];
  for (const base of bases) {
    if (base.kind !== 'folder' || !skipped.has(base.id)) continue;
    const response = await request({
      type: 'knowledge/documents/list',
      baseId: base.id,
      query,
      limit: 8,
    });
    if (!response.success) continue;
    const list = response.data as KnowledgeDocumentListResult;
    for (const entry of list.items) {
      matches.push({ baseId: base.id, baseName: base.name, entry });
    }
  }
  return matches;
}
