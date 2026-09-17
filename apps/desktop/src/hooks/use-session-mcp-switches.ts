/**
 * Session-level MCP switches for the composer "+" → Connectors flyout.
 *
 * A server is on for a session unless the session opted out of it
 * (`SessionSummary.disabledMcpServerIds`). Changes to an existing session
 * commit through `session/set-mcp-servers` and show optimistically until the
 * session index push catches up; Host applies them from the next prompt. A
 * draft holds its choice locally and the send path carries it into
 * `session/create`, so the first prompt already runs with it.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { formatError } from '@piwin/contracts';
import type { HostClient } from '../host-client';

export type SessionMcpSwitches = {
  /** False on Hosts that cannot scope MCP to a session (remote / older Hosts). */
  supported: boolean;
  disabledServerIds: readonly string[];
  error: string | null;
  setServerEnabled: (serverId: string, enabled: boolean) => void;
  /** Draft opt-outs for `session/create`; empty once a session is active. */
  draftDisabledServerIds: readonly string[];
  clearDraft: () => void;
};

export type UseSessionMcpSwitchesArgs = {
  hostClient: HostClient;
  activeSessionId: string | null;
  /** Host projection for the active session (`SessionSummary.disabledMcpServerIds`). */
  sessionDisabledServerIds: readonly string[] | undefined;
};

type PendingSwitches = { sessionId: string; ids: string[] };

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((id) => right.includes(id));
}

export function useSessionMcpSwitches(args: UseSessionMcpSwitchesArgs): SessionMcpSwitches {
  const { hostClient, activeSessionId: sessionId, sessionDisabledServerIds: hostIds } = args;
  const supported = hostClient.supportsCommand('session/set-mcp-servers');
  const [draftIds, setDraftIds] = useState<string[]>([]);
  const [pending, setPending] = useState<PendingSwitches | null>(null);
  const [error, setError] = useState<string | null>(null);
  const hostClientRef = useRef(hostClient);
  hostClientRef.current = hostClient;

  const disabledServerIds = useMemo<readonly string[]>(() => {
    if (!sessionId) return draftIds;
    if (pending?.sessionId === sessionId) return pending.ids;
    return hostIds ?? [];
  }, [draftIds, hostIds, pending, sessionId]);

  useEffect(() => {
    if (pending && pending.sessionId === sessionId && sameIds(pending.ids, hostIds ?? [])) {
      setPending(null);
    }
  }, [hostIds, pending, sessionId]);

  const commit = useCallback(async (targetSessionId: string, ids: string[]) => {
    setPending({ sessionId: targetSessionId, ids });
    setError(null);
    try {
      const response = await hostClientRef.current.request({
        type: 'session/set-mcp-servers',
        sessionId: targetSessionId,
        disabledServerIds: ids,
      });
      if (!response.success) {
        setError(response.error);
        setPending(null);
      }
    } catch (caught) {
      setError(formatError(caught));
      setPending(null);
    }
  }, []);

  const setServerEnabled = useCallback(
    (serverId: string, enabled: boolean) => {
      const next = enabled
        ? disabledServerIds.filter((id) => id !== serverId)
        : disabledServerIds.includes(serverId)
          ? [...disabledServerIds]
          : [...disabledServerIds, serverId];
      if (sessionId) {
        void commit(sessionId, next);
      } else {
        setDraftIds(next);
      }
    },
    [commit, disabledServerIds, sessionId],
  );

  const clearDraft = useCallback(() => setDraftIds([]), []);

  return useMemo(
    () => ({
      supported,
      disabledServerIds,
      error,
      setServerEnabled,
      draftDisabledServerIds: sessionId ? [] : draftIds,
      clearDraft,
    }),
    [clearDraft, disabledServerIds, draftIds, error, sessionId, setServerEnabled, supported],
  );
}
