import { useCallback, useRef, useState } from 'react';
import type { HostCommand, HostResponse, MarketplaceSearchHit } from '@piwin/contracts';
import { isMarketplaceSearchResult } from '@piwin/contracts';

export type MarketplaceEcosystemSearch = {
  hits: MarketplaceSearchHit[];
  loading: boolean;
  error: string | null;
  searchedQuery: string;
  search: (query: string) => Promise<void>;
  reset: () => void;
};

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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchedQuery, setSearchedQuery] = useState('');

  const search = useCallback(async (rawQuery: string): Promise<void> => {
    const trimmed = rawQuery.trim();
    if (!trimmed) {
      setHits([]);
      setError(null);
      setLoading(false);
      setSearchedQuery('');
      return;
    }

    setSearchedQuery(trimmed);
    setLoading(true);
    setError(null);

    try {
      const response = await optionsRef.current.request({
        type: 'marketplace/search',
        query: trimmed,
      });
      if (!response.success) {
        setHits([]);
        setError(response.error);
        optionsRef.current.onError?.(response.error);
        return;
      }

      const data = isMarketplaceSearchResult(response.data)
        ? response.data
        : { query: trimmed, hits: [] as MarketplaceSearchHit[] };
      setHits(data.hits);
      const remoteError = data.remoteError ?? null;
      setError(remoteError);
      if (remoteError) {
        optionsRef.current.onError?.(remoteError);
      }
    } catch (caught: unknown) {
      const message = caught instanceof Error ? caught.message : String(caught);
      setHits([]);
      setError(message);
      optionsRef.current.onError?.(message);
    } finally {
      setLoading(false);
    }
  }, []);

  const reset = useCallback((): void => {
    setHits([]);
    setError(null);
    setLoading(false);
    setSearchedQuery('');
  }, []);

  return { hits, loading, error, searchedQuery, search, reset };
}
