/**
 * Load Host-projected session Sources/Outputs. Failures stay empty rather
 * than guessing from the local transcript.
 */
import { useEffect, useState } from 'react';
import type { SessionResource, SessionResourcesData } from '@piwin/contracts';
import type { HostClient } from '../host/host-client';

export function useSessionResources(input: {
  hostClient: HostClient;
  sessionId: string | null;
  messageCount: number | null;
}): readonly SessionResource[] {
  const [resources, setResources] = useState<readonly SessionResource[]>([]);

  useEffect(() => {
    if (input.sessionId === null) {
      setResources([]);
      return;
    }
    const sessionId = input.sessionId;
    let cancelled = false;
    void input.hostClient
      .request({ type: 'session/resources', sessionId })
      .then((response) => {
        if (cancelled) return;
        if (!response.success || response.data === undefined || typeof response.data !== 'object') {
          setResources([]);
          return;
        }
        const data = response.data as SessionResourcesData;
        setResources(Array.isArray(data.resources) ? data.resources : []);
      })
      .catch(() => {
        if (!cancelled) setResources([]);
      });
    return () => {
      cancelled = true;
    };
  }, [input.hostClient, input.sessionId, input.messageCount]);

  return resources;
}
