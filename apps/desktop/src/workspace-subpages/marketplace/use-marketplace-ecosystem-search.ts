import { useCallback, useRef, useState } from 'react';
import type { HostCommand, HostResponse, MarketplaceSearchHit } from '@piwin/contracts';
import { isMarketplaceSearchResult } from '@piwin/contracts';

/** npm/GitHub/skills answer in a second or two; the MCP registry's search can take ~30 s. */
const FAST_SOURCES = ['packages', 'skills'] as const;
const SLOW_SOURCES = ['mcp'] as const;

/** Same order as a single combined search: packages, then MCP servers, then skills. */
function orderHits(fast: readonly MarketplaceSearchHit[], mcp: readonly MarketplaceSearchHit[]) {
  const isSkill = (hit: MarketplaceSearchHit) => hit.source === 'skill';
  return [...fast.filter((hit) => !isSkill(hit)), ...mcp, ...fast.filter(isSkill)];
}

export type MarketplaceEcosystemSearch = {
  hits: MarketplaceSearchHit[];
  loading: boolean;
  /** Fast results are shown; the MCP registry part of the search is still running. */
  mcpLoading: boolean;
  error: string | null;
  searchedQuery: string;
  /** True while a larger page may exist (the last page filled its limit). */
  hasMore: boolean;
  browse: (limit?: number) => Promise<void>;
  search: (query: string, limit?: number) => Promise<void>;
  /** Re-reads the current browse or query with a larger page. */
  loadMore: () => Promise<void>;
  reset: () => void;
};

/** Host clamps per-source results to 50. */
export const ECOSYSTEM_MAX_LIMIT = 50;
const BROWSE_PREVIEW_LIMIT = 4;
const SEARCH_LIMIT = 20;
const PAGE_STEP = 20;

export type UseMarketplaceEcosystemSearchOptions = {
  request: (command: HostCommand) => Promise<HostResponse>;
  onError?: ((error: string) => void) | undefined;
};

export function useMarketplaceEcosystemSearch(
  options: UseMarketplaceEcosystemSearchOptions,
): MarketplaceEcosystemSearch {
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const [hits, setHits] = useState<MarketplaceSearchHit[]>([]);
  const [browseHits, setBrowseHits] = useState<MarketplaceSearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [mcpLoading, setMcpLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchedQuery, setSearchedQuery] = useState('');
  const [limit, setLimit] = useState(BROWSE_PREVIEW_LIMIT);
  const [browseLimit, setBrowseLimit] = useState(BROWSE_PREVIEW_LIMIT);
  const requestSequence = useRef(0);

  const browse = useCallback(async (nextLimit = BROWSE_PREVIEW_LIMIT): Promise<void> => {
    const sequence = ++requestSequence.current;
    setLoading(true);
    setLimit(nextLimit);
    setBrowseLimit(nextLimit);
    try {
      const response = await optionsRef.current.request({
        type: 'marketplace/search',
        query: '',
        limit: nextLimit,
      });
      if (sequence !== requestSequence.current) return;
      if (!response.success) {
        setError(response.error);
        return;
      }
      const nextHits = isMarketplaceSearchResult(response.data) ? response.data.hits : [];
      setBrowseHits(nextHits);
      setHits(nextHits);
      setError(
        isMarketplaceSearchResult(response.data) ? (response.data.remoteError ?? null) : null,
      );
    } catch (caught: unknown) {
      if (sequence === requestSequence.current) {
        setError(caught instanceof Error ? caught.message : String(caught));
      }
    } finally {
      if (sequence === requestSequence.current) setLoading(false);
    }
  }, []);

  const search = useCallback(
    async (rawQuery: string, nextLimit = SEARCH_LIMIT): Promise<void> => {
      const trimmed = rawQuery.trim();
      if (!trimmed) {
        setHits(browseHits);
        setError(null);
        setLoading(false);
        setSearchedQuery('');
        setLimit(browseLimit);
        return;
      }

      const sequence = ++requestSequence.current;
      setSearchedQuery(trimmed);
      setLimit(nextLimit);
      setLoading(true);
      setError(null);

      const current = () => sequence === requestSequence.current;
      let fastHits: MarketplaceSearchHit[] = [];
      let mcpHits: MarketplaceSearchHit[] = [];
      const errors: Partial<Record<'fast' | 'mcp', string>> = {};
      const publishError = (part: 'fast' | 'mcp') => {
        setError([errors.fast, errors.mcp].filter(Boolean).join('; ') || null);
        // Notify once per failing part, not again with the other part's error.
        const message = errors[part];
        if (message) optionsRef.current.onError?.(message);
      };
      const run = async (
        part: 'fast' | 'mcp',
        sources: readonly ('packages' | 'skills' | 'mcp')[],
      ): Promise<void> => {
        try {
          const response = await optionsRef.current.request({
            type: 'marketplace/search',
            query: trimmed,
            limit: nextLimit,
            sources: [...sources],
          });
          if (!current()) return;
          if (!response.success) {
            errors[part] = response.error;
          } else {
            const data = isMarketplaceSearchResult(response.data) ? response.data : undefined;
            if (part === 'fast') fastHits = data?.hits ?? [];
            else mcpHits = data?.hits ?? [];
            if (data?.remoteError) errors[part] = data.remoteError;
          }
        } catch (caught: unknown) {
          if (!current()) return;
          errors[part] = caught instanceof Error ? caught.message : String(caught);
        }
        setHits(orderHits(fastHits, mcpHits));
        publishError(part);
      };

      setMcpLoading(true);
      const slow = run('mcp', SLOW_SOURCES).finally(() => {
        if (current()) setMcpLoading(false);
      });
      await run('fast', FAST_SOURCES);
      if (current()) setLoading(false);
      await slow;
    },
    [browseHits, browseLimit],
  );

  const reset = useCallback((): void => {
    requestSequence.current += 1;
    setHits(browseHits);
    setError(null);
    setLoading(false);
    setMcpLoading(false);
    setSearchedQuery('');
    setLimit(browseLimit);
  }, [browseHits, browseLimit]);

  const loadMore = useCallback(async (): Promise<void> => {
    const nextLimit = Math.min(
      ECOSYSTEM_MAX_LIMIT,
      limit < PAGE_STEP ? PAGE_STEP : limit + PAGE_STEP,
    );
    if (searchedQuery) await search(searchedQuery, nextLimit);
    else await browse(nextLimit);
  }, [browse, limit, search, searchedQuery]);

  // A page that came back short of its limit is the whole result set.
  const hasMore = limit < ECOSYSTEM_MAX_LIMIT && hits.length >= limit;

  return {
    hits,
    loading,
    mcpLoading,
    error,
    searchedQuery,
    hasMore,
    browse,
    search,
    loadMore,
    reset,
  };
}
