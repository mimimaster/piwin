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
 * Mounted knowledge bases for the active conversation. Changes to an existing
 * session apply optimistically until the Host's session index push catches
 * up. A draft without a session yet just holds its choice locally — the
 * composer send path reads it directly (see `knowledgeMountsRef`) and carries
 * it into `session/create`, so it's live from the first prompt, not a
 * follow-up write.
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

  // No "apply draftIds once a session appears" effect: `session/create` now
  // takes `knowledgeBaseIds` directly (see `ensureSession`/`use-composer-send.ts`),
  // so a session is never created without its mount already attached — a
  // follow-up `session/set-knowledge-bases` here would at best be a redundant
  // write and at worst race the `session/index-updated` push this hook reads
  // `hostIds` from.
  const clearDraft = useCallback(() => setDraftIds([]), []);

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
      clearDraft,
    }),
    [args.onOpenManager, args.supported, bases, clearDraft, error, mount, mountedIds, toggle],
  );
}
