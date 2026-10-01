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
    let cancelled = false;
    void hostClient.request({ type: 'extensions/list' }).then((response) => {
      if (cancelled || !response.success) return;
      const extensions = (response.data as { extensions?: ExtensionSummary[] } | undefined)?.extensions;
      setBackends(enabledExtensionSessionBackends(Array.isArray(extensions) ? extensions : []));
    }).catch(() => {
      if (!cancelled) setBackends([]);
    });
    return () => {
      cancelled = true;
    };
  }, [hostClient]);
  return backends;
}
