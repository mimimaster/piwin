/**
 * Enabled and installed session backends come from extension declarations in
 * `piwin.json`, never a bundled catalog.
 */
import { createContext, createElement, useContext, useEffect, useMemo, useState, type ReactElement, type ReactNode } from 'react';
import {
  enabledExtensionSessionBackends,
  installedExtensionSessionBackends,
  type EnabledExtensionSessionBackend,
  type ExtensionSummary,
  type InstalledExtensionSessionBackend,
} from '@piwin/contracts';
import type { SessionBackendCatalogMap } from '../agents/agent-backend-state';
import type { HostClient } from '../host/host-client';

type SessionBackendCatalogContextValue = {
  hostClient: HostClient | null;
  enabledBackends: EnabledExtensionSessionBackend[];
  installedBackends: InstalledExtensionSessionBackend[];
  catalogByAgentId: SessionBackendCatalogMap;
};

const EMPTY_CATALOG: SessionBackendCatalogMap = {};

const SessionBackendCatalogContext = createContext<SessionBackendCatalogContextValue | null>(null);

function useExtensionListSubscription(hostClient: HostClient | null | undefined): ExtensionSummary[] {
  const [extensions, setExtensions] = useState<ExtensionSummary[]>([]);
  useEffect(() => {
    if (!hostClient?.request || !hostClient?.subscribe) {
      setExtensions([]);
      return;
    }
    const client = hostClient;
    let cancelled = false;
    let requestVersion = 0;
    async function refresh(): Promise<void> {
      const version = ++requestVersion;
      try {
        const response = await client.request({ type: 'extensions/list' });
        if (cancelled || version !== requestVersion) return;
        if (!response.success) throw new Error(response.error);
        const list = (response.data as { extensions?: ExtensionSummary[] } | undefined)?.extensions;
        setExtensions(Array.isArray(list) ? list : []);
      } catch (error) {
        if (cancelled || version !== requestVersion) return;
        console.error('[session-backends] extensions/list failed', error);
        setExtensions([]);
      }
    }
    const unsubscribe = client.subscribe((message) => {
      if (message.type === 'marketplace/inventory-updated' && message.changedKinds.includes('extension')) {
        void refresh();
      }
    });
    void refresh();
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [hostClient]);
  return extensions;
}

function buildCatalogMap(installed: readonly InstalledExtensionSessionBackend[]): SessionBackendCatalogMap {
  if (installed.length === 0) return EMPTY_CATALOG;
  const map: Record<string, { name: string; icon?: InstalledExtensionSessionBackend['icon'] }> = {};
  for (const backend of installed) {
    map[backend.agentId] = {
      name: backend.name,
      ...(backend.icon ? { icon: backend.icon } : {}),
    };
  }
  return map;
}

export function SessionBackendCatalogProvider(props: {
  hostClient?: HostClient | null | undefined;
  /** Explicit catalog override for unit tests without a live HostClient. */
  catalog?: SessionBackendCatalogMap | undefined;
  children: ReactNode;
}): ReactElement {
  const extensions = useExtensionListSubscription(props.catalog ? undefined : props.hostClient);
  const value = useMemo<SessionBackendCatalogContextValue>(() => {
    if (props.catalog) {
      return {
        hostClient: null,
        enabledBackends: [],
        installedBackends: [],
        catalogByAgentId: props.catalog,
      };
    }
    const enabledBackends = enabledExtensionSessionBackends(extensions);
    const installedBackends = installedExtensionSessionBackends(extensions);
    return {
      hostClient: props.hostClient ?? null,
      enabledBackends,
      installedBackends,
      catalogByAgentId: buildCatalogMap(installedBackends),
    };
  }, [extensions, props.catalog, props.hostClient]);

  return createElement(SessionBackendCatalogContext.Provider, { value }, props.children);
}

export function useSessionBackendCatalog(): SessionBackendCatalogMap {
  return useContext(SessionBackendCatalogContext)?.catalogByAgentId ?? EMPTY_CATALOG;
}

export function useEnabledSessionBackends(
  hostClient: HostClient | null | undefined,
): EnabledExtensionSessionBackend[] {
  const context = useContext(SessionBackendCatalogContext);
  const shared = Boolean(context && hostClient && context.hostClient === hostClient);
  const standaloneExtensions = useExtensionListSubscription(shared ? undefined : hostClient);
  const standaloneBackends = useMemo(
    () => enabledExtensionSessionBackends(standaloneExtensions),
    [standaloneExtensions],
  );
  if (!hostClient) return [];
  return shared && context ? context.enabledBackends : standaloneBackends;
}
