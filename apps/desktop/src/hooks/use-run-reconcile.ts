import { useCallback, useEffect, useRef, type Dispatch } from 'react';
import type { ExecutionRunRecord, SessionTranscriptMessage } from '@piwin/contracts';
import { isRunActive } from '@piwin/contracts';
import type { HostClient } from '../host-client.js';
import type { ChatUiAction } from '../chat-reducer.js';
import { planRunReconcile } from '../run-reconcile.js';

export type UseRunReconcileArgs = {
  hostClient: HostClient;
  dispatch: Dispatch<ChatUiAction>;
  activeSessionId: string | null;
  /** Run id the UI currently attributes its live state to (may be null). */
  activeRunId: string | null;
  /** True while the UI believes a run is live, including control transitions. */
  runLive: boolean;
  /** Re-ask Host after a remote socket comes back. */
  hostReady?: boolean;
  /** Remote snapshot / catch-up fence — reload transcript even when idle. */
  catchUpEpoch?: number;
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

  const loadTranscript = useCallback(
    async (sessionId: string): Promise<void> => {
      const messagesResponse = await hostClient.request({
        type: 'session/messages',
        sessionId,
      });
      if (sessionRef.current !== sessionId) {
        return;
      }
      if (!messagesResponse.success) {
        return;
      }
      const data = messagesResponse.data as { messages?: SessionTranscriptMessage[] } | undefined;
      if (!Array.isArray(data?.messages)) {
        return;
      }
      dispatch({
        type: 'session/load-messages',
        sessionId,
        messages: data.messages,
      });
    },
    [dispatch, hostClient],
  );

  /** Live-run path: gap / focus / visibility. Idle sessions stay quiet. */
  const reconcileLive = useCallback(async (): Promise<void> => {
    const sessionId = sessionRef.current;
    if (!sessionId || !runLiveRef.current) {
      return;
    }
    if (hostClient.supportsCommand?.('session/foreground-run') === false) {
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
    await loadTranscript(sessionId);
    if (sessionRef.current !== sessionId || runIdRef.current !== runIdAtStart) {
      return;
    }
    if (decision === 'apply-terminal' && run) {
      dispatch({ type: 'run/terminal', run });
    } else {
      dispatch({ type: 'run/stale-clear', sessionId });
    }
  }, [dispatch, hostClient, loadTranscript]);

  /** Snapshot / reconnect catch-up: reload transcript even when idle. */
  const reconcileCatchUp = useCallback(async (): Promise<void> => {
    const sessionId = sessionRef.current;
    if (!sessionId) {
      return;
    }
    if (runLiveRef.current) {
      await reconcileLive();
      return;
    }
    await loadTranscript(sessionId);
  }, [loadTranscript, reconcileLive]);

  const selectionGenerationRef = useRef(0);
  const admitSelectedSession = useCallback(
    (sessionId: string, generation: number): void => {
      dispatch({ type: 'foreground/admission', admission: 'reconciling' });
      if (hostClient.supportsCommand?.('session/foreground-run') === false) {
        dispatch({ type: 'foreground/admission', admission: 'ready' });
        return;
      }
      void hostClient
        .request({ type: 'session/foreground-run', sessionId })
        .then((response) => {
          if (selectionGenerationRef.current !== generation || sessionRef.current !== sessionId) {
            return;
          }
          if (!response.success) {
            dispatch({ type: 'foreground/admission', admission: 'unknown' });
            return;
          }
          const run =
            (response.data as { run?: ExecutionRunRecord | null } | undefined)?.run ?? null;
          if (run && isRunActive(run.status)) {
            dispatch({ type: 'run/updated', run });
          }
          dispatch({ type: 'foreground/admission', admission: 'ready' });
        })
        .catch(() => {
          if (selectionGenerationRef.current === generation && sessionRef.current === sessionId) {
            dispatch({ type: 'foreground/admission', admission: 'unknown' });
          }
        });
    },
    [dispatch, hostClient],
  );
  const reconcilingRef = useRef(false);
  const rerunLiveRef = useRef(false);
  const rerunCatchUpRef = useRef(false);

  const schedule = useCallback(
    (mode: 'live' | 'catch-up'): void => {
      if (reconcilingRef.current) {
        if (mode === 'live') {
          rerunLiveRef.current = true;
        } else {
          rerunCatchUpRef.current = true;
        }
        return;
      }
      reconcilingRef.current = true;
      const work = mode === 'live' ? reconcileLive() : reconcileCatchUp();
      void work
        .catch(() => undefined)
        .finally(() => {
          reconcilingRef.current = false;
          if (rerunCatchUpRef.current) {
            rerunCatchUpRef.current = false;
            rerunLiveRef.current = false;
            schedule('catch-up');
            return;
          }
          if (rerunLiveRef.current) {
            rerunLiveRef.current = false;
            schedule('live');
          }
        });
    },
    [reconcileCatchUp, reconcileLive],
  );

  useEffect(() => {
    hostClient.registerSequenceGapHandler(() => schedule('live'));
    return () => hostClient.registerSequenceGapHandler(null);
  }, [hostClient, schedule]);

  useEffect(() => {
    const sessionId = args.activeSessionId;
    if (!sessionId) {
      dispatch({ type: 'foreground/admission', admission: 'unknown' });
      return;
    }
    const generation = selectionGenerationRef.current + 1;
    selectionGenerationRef.current = generation;
    admitSelectedSession(sessionId, generation);
  }, [admitSelectedSession, args.activeSessionId, dispatch]);

  useEffect(() => {
    const handleFocus = (): void => schedule('live');
    const handleVisibility = (): void => {
      if (document.visibilityState === 'visible') {
        schedule('live');
      }
    };
    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [schedule]);

  useEffect(() => {
    if (args.hostReady !== true) {
      return;
    }
    schedule('catch-up');
    const sessionId = sessionRef.current;
    if (!sessionId) {
      return;
    }
    const generation = selectionGenerationRef.current + 1;
    selectionGenerationRef.current = generation;
    admitSelectedSession(sessionId, generation);
  }, [admitSelectedSession, args.hostReady, schedule]);

  useEffect(() => {
    if (args.catchUpEpoch === undefined || args.catchUpEpoch === 0) {
      return;
    }
    if (args.hostReady !== true) {
      return;
    }
    schedule('catch-up');
  }, [args.catchUpEpoch, args.hostReady, schedule]);
}
