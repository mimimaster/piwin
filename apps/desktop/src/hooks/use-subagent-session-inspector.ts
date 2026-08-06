/**
 * Subagent session inspector controller.
 *
 * Owns the selected child identity, the `session/messages` history load
 * (with stale-response protection), and the one-shot terminal refresh that
 * replaces the live tail with persisted final content. It never changes the
 * active session, never aborts a child, and reads the live tail / latest
 * summary from the reducer-owned maps supplied by the caller. Persisted and
 * live content are reconciled here by the pure session projection so leaf
 * components never re-implement message-id deduplication.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SessionSummary, SessionTranscriptMessage } from '@piwin/contracts'
import { formatError } from '@piwin/contracts';;
import type { HostClient } from '../host-client';
import type { ChatMessageUi, SubagentStreamState } from '../chat-reducer';
import type { SubagentInspectorSelection } from '../subagent-activity-model';
import { deriveSubagentDialogStatus, type ActiveSubagentStatus } from '../subagent-activity-model';
import { reconcileSubagentTranscript } from '../subagent-session-projection';

export type SubagentInspectorOptions = {
  hostClient: HostClient;
  /** Read the live tail for a child from the reducer-owned stream map. */
  streamFor: (childSessionId: string) => SubagentStreamState | undefined;
  /** Read the latest child summary from the reducer-owned children map. */
  childFor: (childSessionId: string) => SessionSummary | undefined;
  /** Called when the user promotes the preview to the full session view. */
  onOpenFullSession: (sessionId: string) => void;
};

export type SubagentInspectorController = {
  /** Selected child identity; null when the inspector is closed. */
  selection: SubagentInspectorSelection | null;
  /** Derived header status (live stream preferred over summary). */
  status: ActiveSubagentStatus;
  /** Persisted history reconciled with the live tail (one continuous view). */
  messages: ChatMessageUi[];
  /** Live tail after reconciliation; null when the child is silent. */
  liveTail: SubagentStreamState | null;
  loading: boolean;
  error: string | null;
  openInspector: (selection: SubagentInspectorSelection) => void;
  closeInspector: () => void;
  /** Promote the preview to the existing full session view. */
  openFullSession: () => void;
  retryLoad: () => void;
};

export function useSubagentSessionInspector(
  options: SubagentInspectorOptions,
): SubagentInspectorController {
  const { hostClient, streamFor, childFor, onOpenFullSession } = options;

  // Latest lookups/navigation without forcing controller method identity churn.
  const streamForRef = useRef(streamFor);
  const childForRef = useRef(childFor);
  const onOpenFullSessionRef = useRef(onOpenFullSession);
  streamForRef.current = streamFor;
  childForRef.current = childFor;
  onOpenFullSessionRef.current = onOpenFullSession;

  const [selection, setSelection] = useState<SubagentInspectorSelection | null>(null);
  const [historicalMessages, setHistoricalMessages] = useState<SessionTranscriptMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Monotonic guard so a slow `session/messages` response cannot land after
   *  the user opened another child or closed the dialog. */
  const requestSeqRef = useRef(0);
  /** Child for which the terminal refresh already ran (per selection). */
  const terminalRefreshedForRef = useRef<string | null>(null);
  /** Tracks which child the retained history belongs to. */
  const loadedChildIdRef = useRef<string | null>(null);

  const childSessionId = selection?.childSessionId ?? null;
  const stream =
    childSessionId !== null ? (streamForRef.current(childSessionId) ?? null) : null;

  const loadMessages = useCallback(
    async (targetSessionId: string, requestSeq: number): Promise<void> => {
      setLoading(true);
      setError(null);
      try {
        const response = await hostClient.request({
          type: 'session/messages',
          sessionId: targetSessionId,
        });
        if (requestSeq !== requestSeqRef.current) {
          return;
        }
        if (response.success) {
          const data = response.data as { messages: SessionTranscriptMessage[] } | undefined;
          setHistoricalMessages(data?.messages ?? []);
          loadedChildIdRef.current = targetSessionId;
        } else {
          setError(response.error);
        }
      } catch (requestError) {
        if (requestSeq !== requestSeqRef.current) {
          return;
        }
        setError(formatError(requestError));
      } finally {
        if (requestSeq === requestSeqRef.current) {
          setLoading(false);
        }
      }
    },
    [hostClient],
  );

  const openInspector = useCallback(
    (next: SubagentInspectorSelection): void => {
      requestSeqRef.current += 1;
      terminalRefreshedForRef.current = null;
      const switchingChild = loadedChildIdRef.current !== next.childSessionId;
      setSelection(next);
      // Keep the previous transcript when re-opening the same child so the
      // dialog does not flash empty; clear only when switching to another child.
      if (switchingChild) {
        setHistoricalMessages([]);
        loadedChildIdRef.current = null;
      }
      setError(null);
      void loadMessages(next.childSessionId, requestSeqRef.current);
    },
    [loadMessages],
  );

  const closeInspector = useCallback((): void => {
    requestSeqRef.current += 1;
    setSelection(null);
    setHistoricalMessages([]);
    loadedChildIdRef.current = null;
    setLoading(false);
    setError(null);
  }, []);

  const retryLoad = useCallback((): void => {
    if (childSessionId === null) {
      return;
    }
    requestSeqRef.current += 1;
    terminalRefreshedForRef.current = null;
    void loadMessages(childSessionId, requestSeqRef.current);
  }, [childSessionId, loadMessages]);

  const openFullSession = useCallback((): void => {
    if (childSessionId === null) {
      return;
    }
    const targetSessionId = childSessionId;
    closeInspector();
    onOpenFullSessionRef.current(targetSessionId);
  }, [childSessionId, closeInspector]);

  // Replace the live tail with persisted final content exactly once per
  // selection after the stream transitions to terminal. The hook keeps the
  // last loaded view visible while refreshing so the dialog never flashes
  // empty; closing during the refresh is protected by the request seq.
  useEffect(() => {
    if (childSessionId === null || stream === null) {
      return;
    }
    if (stream.streaming || terminalRefreshedForRef.current === childSessionId) {
      return;
    }
    terminalRefreshedForRef.current = childSessionId;
    requestSeqRef.current += 1;
    void loadMessages(childSessionId, requestSeqRef.current);
  }, [childSessionId, stream, loadMessages]);

  const status: ActiveSubagentStatus =
    childSessionId === null
      ? 'running'
      : deriveSubagentDialogStatus({
          child: childForRef.current(childSessionId),
          stream: stream ?? undefined,
        });

  const projected = useMemo(
    () => reconcileSubagentTranscript({ historicalMessages, stream }),
    [historicalMessages, stream],
  );

  return {
    selection,
    status,
    messages: projected.historicalMessages,
    liveTail: projected.liveTail,
    loading,
    error,
    openInspector,
    closeInspector,
    openFullSession,
    retryLoad,
  };
}
