import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { formatError, type HostPush } from '@piwin/contracts';
import type { KnowledgeMountsValue } from './knowledge-mounts-context.js';
import { useKnowledgeBases, type KnowledgeBasesRequest } from './use-knowledge-bases.js';

export type UseSessionKnowledgeMountsArgs = {
  request: KnowledgeBasesRequest;
  subscribePush?: ((listener: (push: HostPush) => void) => () => void) | undefined;
  supported: boolean;
  activeSessionId: string | null;
  /** Host projection for the active session (`SessionSummary.knowledgeBaseIds`). */
  sessionMountedIds: readonly string[] | undefined;
  onOpenManager: () => void;
};

type PendingMounts = { sessionId: string; ids: string[] };

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((id) => right.includes(id));
}

/**
 * Mounted knowledge bases for the active conversation. Changes apply
 * optimistically until the Host's session index push catches up; a draft
 * without a session keeps its choice and applies it once the session exists.
 */
export function useSessionKnowledgeMounts(args: UseSessionKnowledgeMountsArgs): KnowledgeMountsValue {
  const { bases } = useKnowledgeBases({
    request: args.request,
    subscribePush: args.subscribePush,
    enabled: args.supported,
  });
  const [draftIds, setDraftIds] = useState<string[]>([]);
  const [pending, setPending] = useState<PendingMounts | null>(null);
  const [error, setError] = useState<string | null>(null);
  const requestRef = useRef(args.request);
  requestRef.current = args.request;

  const sessionId = args.activeSessionId;
  const hostIds = args.sessionMountedIds;
  const mountedIds = useMemo<readonly string[]>(() => {
    if (!sessionId) return draftIds;
    if (pending?.sessionId === sessionId) return pending.ids;
    return hostIds ?? [];
  }, [draftIds, hostIds, pending, sessionId]);

  const commit = useCallback(async (targetSessionId: string, ids: string[]) => {
    setPending({ sessionId: targetSessionId, ids });
    setError(null);
    try {
      const response = await requestRef.current({
        type: 'session/set-knowledge-bases',
        sessionId: targetSessionId,
        baseIds: ids,
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

  useEffect(() => {
    if (pending && pending.sessionId === sessionId && sameIds(pending.ids, hostIds ?? [])) {
      setPending(null);
    }
  }, [hostIds, pending, sessionId]);

  const draftRef = useRef(draftIds);
  draftRef.current = draftIds;
  const hostIdsRef = useRef(hostIds);
  hostIdsRef.current = hostIds;
  useEffect(() => {
    if (!sessionId || draftRef.current.length === 0) return;
    const ids = draftRef.current;
    setDraftIds([]);
    // Never overwrite a conversation that already chose its own bases.
    if ((hostIdsRef.current ?? []).length === 0) void commit(sessionId, ids);
  }, [commit, sessionId]);

  const setMounted = useCallback(
    (ids: string[]) => {
      if (sessionId) {
        void commit(sessionId, ids);
      } else {
        setDraftIds(ids);
      }
    },
    [commit, sessionId],
  );

  const toggle = useCallback(
    (baseId: string) => {
      setMounted(
        mountedIds.includes(baseId)
          ? mountedIds.filter((id) => id !== baseId)
          : [...mountedIds, baseId],
      );
    },
    [mountedIds, setMounted],
  );

  const mount = useCallback(
    (baseId: string) => {
      if (!mountedIds.includes(baseId)) setMounted([...mountedIds, baseId]);
    },
    [mountedIds, setMounted],
  );

  return useMemo(
    () => ({
      supported: args.supported,
      bases,
      mountedIds,
      error,
      toggle,
      mount,
      openManager: args.onOpenManager,
    }),
    [args.onOpenManager, args.supported, bases, error, mount, mountedIds, toggle],
  );
}
