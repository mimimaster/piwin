import { useCallback, useEffect, useRef, type Dispatch } from 'react';
import type { ExecutionRunRecord, SessionTranscriptMessage } from '@piwin/contracts';
import type { HostClient } from '../host-client.js';
import type { ChatUiAction } from '../chat-reducer.js';
import { planRunReconcile } from '../run-reconcile.js';

export type UseRunReconcileArgs = {
  hostClient: HostClient;
  dispatch: Dispatch<ChatUiAction>;
  activeSessionId: string | null;
  /** Run id the UI currently attributes its live state to (may be null). */
  activeRunId: string | null;
  /** True while the UI believes a run is live (streaming or aborting). */
  runLive: boolean;
};

/**
 * ADR 0038 reconciliation: when pushes are suspected lost, ask the Host what
 * actually happened instead of healing over the hole. Event-driven only — a
 * sequence gap or a window refocus — there is deliberately no polling timer.
 */
export function useRunReconcile(args: UseRunReconcileArgs): void {
  const { hostClient, dispatch } = args;
  const sessionRef = useRef(args.activeSessionId);
  sessionRef.current = args.activeSessionId;
  const runIdRef = useRef(args.activeRunId);
  runIdRef.current = args.activeRunId;
  const runLiveRef = useRef(args.runLive);
  runLiveRef.current = args.runLive;

  const reconcile = useCallback(async (): Promise<void> => {
    const sessionId = sessionRef.current;
    if (!sessionId || !runLiveRef.current) {
      return;
    }
    const runIdAtStart = runIdRef.current;
    const response = await hostClient.request({
      type: 'session/foreground-run',
      sessionId,
    });
    if (!response.success || sessionRef.current !== sessionId || runIdRef.current !== runIdAtStart) {
      return;
    }
    const run = (response.data as { run?: ExecutionRunRecord | null } | undefined)?.run;
    const decision = planRunReconcile(run);
    if (decision === 'none') {
      return;
    }

    // A lost terminal push usually also lost the final assistant text, so
    // pull the authoritative transcript before settling run state. The
    // load-messages dispatch resets live-run fields; dispatch the terminal
    // afterwards so the resting state keeps the authoritative outcome.
    const messagesResponse = await hostClient.request({
      type: 'session/messages',
      sessionId,
    });
    if (sessionRef.current !== sessionId || runIdRef.current !== runIdAtStart) {
      return;
    }
    if (messagesResponse.success) {
      const data = messagesResponse.data as { messages?: SessionTranscriptMessage[] } | undefined;
      if (Array.isArray(data?.messages)) {
        dispatch({
          type: 'session/load-messages',
          sessionId,
          messages: data.messages,
        });
      }
    }
    if (decision === 'apply-terminal' && run) {
      dispatch({ type: 'run/terminal', run });
    } else {
      dispatch({ type: 'run/stale-clear', sessionId });
    }
  }, [dispatch, hostClient]);

  const reconcilingRef = useRef(false);
  const rerunRef = useRef(false);
  const scheduleReconcile = useCallback((): void => {
    if (reconcilingRef.current) {
      rerunRef.current = true;
      return;
    }
    reconcilingRef.current = true;
    void reconcile()
      .catch(() => undefined)
      .finally(() => {
        reconcilingRef.current = false;
        if (rerunRef.current) {
          rerunRef.current = false;
          scheduleReconcile();
        }
      });
  }, [reconcile]);

  useEffect(() => {
    hostClient.registerSequenceGapHandler(() => scheduleReconcile());
    return () => hostClient.registerSequenceGapHandler(null);
  }, [hostClient, scheduleReconcile]);

  useEffect(() => {
    const handleFocus = (): void => scheduleReconcile();
    const handleVisibility = (): void => {
      if (document.visibilityState === 'visible') {
        scheduleReconcile();
      }
    };
    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [scheduleReconcile]);
}
