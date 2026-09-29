/**
 * Cumulative usage of the active session for the composer stats line. Reads
 * `usage/get-session` when the session becomes active and again (debounced)
 * after each finalized request (`usage/update`).
 */
import { useEffect, useState } from 'react';
import type {
  HostCommand,
  HostResponse,
  HostServerMessage,
  SessionUsageTotals,
} from '@piwin/contracts';

export type SessionUsageTotalsHostPort = {
  subscribe(listener: (message: HostServerMessage) => void): () => void;
  request(command: HostCommand): Promise<HostResponse>;
  supportsCommand(type: HostCommand['type']): boolean;
};

const REFRESH_DEBOUNCE_MS = 300;

export function useSessionUsageTotals(
  host: SessionUsageTotalsHostPort,
  sessionId: string | null,
): SessionUsageTotals | null {
  const [totals, setTotals] = useState<SessionUsageTotals | null>(null);

  useEffect(() => {
    setTotals(null);
    if (!sessionId || !host.supportsCommand('usage/get-session')) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = (): void => {
      void host
        .request({ type: 'usage/get-session', sessionId })
        .then((response) => {
          if (disposed || !response.success) return;
          const next = (response.data as { totals?: SessionUsageTotals } | undefined)?.totals;
          if (next && next.sessionId === sessionId) setTotals(next);
        })
        .catch(() => {
          // Stats are decoration; a failed read keeps the last value.
        });
    };
    load();
    const unsubscribe = host.subscribe((message) => {
      if (
        message.type === 'event' &&
        message.event.type === 'usage/update' &&
        message.event.sessionId === sessionId
      ) {
        if (timer) clearTimeout(timer);
        timer = setTimeout(load, REFRESH_DEBOUNCE_MS);
      }
    });
    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
      unsubscribe();
    };
  }, [host, sessionId]);

  return totals;
}
