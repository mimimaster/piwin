import { useEffect, useState } from 'react';
import type { HostCommand, HostResponse, MarketplaceSearchHit } from '@piwin/contracts';
import { isMarketplaceSearchResult } from '@piwin/contracts';

const SEARCH_DEBOUNCE_MS = 280;

export type MarketplaceEcosystemSearch = {
  hits: MarketplaceSearchHit[];
  loading: boolean;
  error: string | null;
};

export function useMarketplaceEcosystemSearch(
  query: string,
  request: (command: HostCommand) => Promise<HostResponse>,
): MarketplaceEcosystemSearch {
  const [hits, setHits] = useState<MarketplaceSearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setHits([]);
      setError(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      setLoading(true);
      void request({ type: 'marketplace/search', query: trimmed })
        .then((response) => {
          if (cancelled) return;
          if (!response.success) {
            setHits([]);
            setError(response.error);
            return;
          }
          const data = isMarketplaceSearchResult(response.data)
            ? response.data
            : { query: trimmed, hits: [] as MarketplaceSearchHit[] };
          setHits(data.hits);
          setError(data.remoteError ?? null);
        })
        .catch((caught: unknown) => {
          if (cancelled) return;
          setHits([]);
          setError(caught instanceof Error ? caught.message : String(caught));
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query, request]);

  return { hits, loading, error };
}
