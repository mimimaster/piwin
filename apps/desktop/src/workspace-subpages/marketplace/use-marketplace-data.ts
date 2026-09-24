/**
 * Loads the curated catalog and the Host inventory, and keeps the inventory
 * fresh from Host pushes. The inventory is only replaced by a successful
 * Host response; a failed refresh keeps the last known state and reports why.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  HostCommand,
  HostResponse,
  HostServerMessage,
  MarketplaceCatalogEntry,
  MarketplaceCatalogListData,
  MarketplaceInstalledItem,
  MarketplaceInstalledListData,
} from '@piwin/contracts';

const TERMINAL_DEPLOYMENT_PHASES = new Set([
  'active',
  'failed',
  'rolled-back',
  'restart-required',
  'superseded',
]);

export type MarketplaceData = {
  entries: MarketplaceCatalogEntry[];
  items: MarketplaceInstalledItem[];
  loading: boolean;
  error: string | null;
  refreshInventory: () => Promise<void>;
};

export function useMarketplaceData(options: {
  request: (command: HostCommand) => Promise<HostResponse>;
  sessionId?: string | null | undefined;
  subscribeHostMessages?: ((listener: (message: HostServerMessage) => void) => () => void) | undefined;
}): MarketplaceData {
  const { request, sessionId, subscribeHostMessages } = options;
  const [entries, setEntries] = useState<MarketplaceCatalogEntry[]>([]);
  const [items, setItems] = useState<MarketplaceInstalledItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  // Parents pass fresh closures every render; pin them so streaming re-renders
  // elsewhere in the workbench do not refetch or resubscribe.
  const requestRef = useRef(request);
  requestRef.current = request;
  const subscribeRef = useRef(subscribeHostMessages);
  subscribeRef.current = subscribeHostMessages;
  const canSubscribe = subscribeHostMessages !== undefined;

  const refreshInventory = useCallback(async (): Promise<void> => {
    // Host-global scope only: remote Hosts reject client-supplied paths, and
    // project-local resources belong to the repository, not the marketplace.
    const response = await requestRef.current({
      type: 'marketplace/installed-list',
      ...(sessionId ? { sessionId } : {}),
    });
    if (!mountedRef.current) return;
    if (!response.success) {
      setError(response.error);
      return;
    }
    const data = response.data as MarketplaceInstalledListData;
    setItems(data.items);
    setError(null);
  }, [sessionId]);

  useEffect(() => {
    mountedRef.current = true;
    setLoading(true);
    void (async () => {
      const [catalog] = await Promise.all([
        requestRef.current({ type: 'marketplace/catalog-list' }),
        refreshInventory(),
      ]);
      if (!mountedRef.current) return;
      if (catalog.success) {
        setEntries((catalog.data as MarketplaceCatalogListData).entries);
      } else {
        setError(catalog.error);
      }
      setLoading(false);
    })();
    return () => {
      mountedRef.current = false;
    };
  }, [refreshInventory]);

  useEffect(() => {
    const subscribe = subscribeRef.current;
    if (!canSubscribe || !subscribe) return undefined;
    return subscribe((message) => {
      if (message.type === 'marketplace/inventory-updated') {
        // Session-scoped availability can differ from the global revision,
        // so equal revisions are not a reason to skip the re-read.
        void refreshInventory();
        return;
      }
      if (
        message.type === 'extension/deployment-updated' &&
        TERMINAL_DEPLOYMENT_PHASES.has(message.deployment.phase) &&
        (!sessionId || message.deployment.sessionId === sessionId)
      ) {
        void refreshInventory();
      }
    });
  }, [canSubscribe, refreshInventory, sessionId]);

  return { entries, items, loading, error, refreshInventory };
}
