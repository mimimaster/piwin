/**
 * Enabled session backends are extension declarations, not a bundled catalog.
 */
import { useEffect, useState } from 'react';
import {
  enabledExtensionSessionBackends,
  type EnabledExtensionSessionBackend,
  type ExtensionSummary,
} from '@piwin/contracts';
import type { HostClient } from '../host-client';

export function useEnabledSessionBackends(
  hostClient: HostClient | null | undefined,
): EnabledExtensionSessionBackend[] {
  const [backends, setBackends] = useState<EnabledExtensionSessionBackend[]>([]);
  useEffect(() => {
    if (!hostClient) {
      setBackends([]);
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
        const extensions = (response.data as { extensions?: ExtensionSummary[] } | undefined)?.extensions;
        setBackends(enabledExtensionSessionBackends(Array.isArray(extensions) ? extensions : []));
      } catch (error) {
        if (cancelled || version !== requestVersion) return;
        console.error('[session-backends] extensions/list failed', error);
        setBackends([]);
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
  return backends;
}
