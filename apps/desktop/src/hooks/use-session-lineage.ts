import { useEffect, useState } from 'react';
import type { ProductSessionLineageView } from '@piwin/contracts';
import type { HostClient } from '../host-client';

function isLineageNode(value: unknown): value is ProductSessionLineageView['nodes'][number] {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.sessionId === 'string' &&
    typeof candidate.isArchived === 'boolean' &&
    typeof candidate.updatedAt === 'string'
  );
}

function isProductSessionLineageView(value: unknown): value is ProductSessionLineageView {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.rootSessionId === 'string' &&
    typeof candidate.activeSessionId === 'string' &&
    typeof candidate.rootMissing === 'boolean' &&
    Array.isArray(candidate.nodes) &&
    candidate.nodes.every(isLineageNode)
  );
}

/** Load the product lineage projection for the currently active session. */
export function useSessionLineage(
  hostClient: HostClient,
  sessionId: string | null,
): ProductSessionLineageView | null {
  const [loadedLineage, setLoadedLineage] = useState<{
    sessionId: string;
    view: ProductSessionLineageView;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoadedLineage(null);
    if (!sessionId || hostClient.supportsCommand?.('session/lineage') === false) return;

    void hostClient
      .request({ type: 'session/lineage', sessionId })
      .then((response) => {
        if (cancelled || !response.success || !isProductSessionLineageView(response.data)) {
          return;
        }
        setLoadedLineage({ sessionId, view: response.data });
      })
      .catch(() => {
        // Lineage is an optional navigation projection. The transcript remains
        // usable when an older Host does not serve this query.
      });

    return () => {
      cancelled = true;
    };
  }, [hostClient, sessionId]);

  return loadedLineage?.sessionId === sessionId ? loadedLineage.view : null;
}
