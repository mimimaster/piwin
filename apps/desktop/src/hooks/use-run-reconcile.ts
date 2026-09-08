import { useCallback, useEffect, useRef, type Dispatch } from 'react';
import type { ExecutionRunRecord, SessionTranscriptMessage } from '@piwin/contracts';
import { isRunActive } from '@piwin/contracts';
import type { HostClient } from '../host-client.js';
import type { ChatUiAction } from '../chat-reducer.js';
import { planRunReconcile } from '../run-reconcile.js';
import { reconcilePendingPermissions } from './reconcile-pending-permissions.js';

// A prompt acknowledgement arrives before provider execution. These are
// bounded convergence checks for a terminal push that was lost after the Run
// was admitted; they stop as soon as the reducer leaves the live state.
const POST_ADMISSION_RECONCILE_DELAYS_MS = [250, 1_000, 3_000, 5_000] as const;

/**
 * Host-up admit failures stay in `reconciling` and retry with backoff.
 * `unknown` is reserved for Host-down / no selection — never a sticky
 * "query failed once" that blocks Send until session switch.
 */
const RECONCILING_ADMISSION_BACKOFF_MS = [400, 1_200, 3_000] as const;

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
  /**
   * Host-owned selected-session admission. Same-session `session/set` (continue
   * in project, project rehome after resume) returns this to `reconciling`
   * without changing `activeSessionId`. Re-admit in that case or Send stays off.
   */
  foregroundAdmission?: 'unknown' | 'reconciling' | 'ready';
};

/**
 * ADR 0038 reconciliation: when pushes are suspected lost, ask the Host what
 * actually happened instead of healing over the hole. Sequence gaps and
 * window refocus are the normal triggers; a newly admitted live Run also gets
 * a small, bounded set of post-admission checks so a lost terminal push cannot
 * leave the shell stuck. This is deliberately not a repeating polling loop.
 */
export function useRunReconcile(args: UseRunReconcileArgs): void {
  const { hostClient, dispatch } = args;
  const sessionRef = useRef(args.activeSessionId);
  sessionRef.current = args.activeSessionId;
  const runIdRef = useRef(args.activeRunId);
  runIdRef.current = args.activeRunId;
  const runLiveRef = useRef(args.runLive);
  runLiveRef.current = args.runLive;
  const admissionRef = useRef(args.foregroundAdmission ?? 'unknown');
  admissionRef.current = args.foregroundAdmission ?? 'unknown';
  const hostReadyRef = useRef(args.hostReady);
  hostReadyRef.current = args.hostReady;
  const admitBackoffAttemptRef = useRef(0);
  const admitBackoffTimerRef = useRef<ReturnType<typeof globalThis.setTimeout> | null>(null);

  const clearAdmitBackoffTimer = useCallback((): void => {
    if (admitBackoffTimerRef.current !== null) {
      globalThis.clearTimeout(admitBackoffTimerRef.current);
      admitBackoffTimerRef.current = null;
    }
  }, []);

  const loadTranscript = useCallback(
    async (sessionId: string, options?: { preserveActiveTail?: boolean }): Promise<void> => {
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
        ...(options?.preserveActiveTail === true || runLiveRef.current
          ? { preserveActiveTail: true }
          : {}),
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
    if (
      !response.success ||
      sessionRef.current !== sessionId ||
      runIdRef.current !== runIdAtStart
    ) {
      return;
    }
    const run = (response.data as { run?: ExecutionRunRecord | null } | undefined)?.run;
    // Paint-first / pre-ACK: Host null is a race — do not wipe the optimistic
    // bubble. A confirmed activeRunId + Host null means a lost terminal push.
    if ((run === null || run === undefined) && runIdAtStart === null) {
      return;
    }
    const decision = planRunReconcile(run);
    if (decision === 'none') {
      return;
    }

    // A lost terminal push usually also lost the final assistant text, so
    // pull the authoritative transcript before settling run state. Always
    // preserve the local live tail while merging.
    await loadTranscript(sessionId, { preserveActiveTail: true });
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
  const admitSelectedSessionRef = useRef<(sessionId: string, generation: number) => void>(
    () => undefined,
  );

  const scheduleReconcilingAdmitBackoff = useCallback(
    (sessionId: string): void => {
      clearAdmitBackoffTimer();
      const attempt = admitBackoffAttemptRef.current;
      const delay = RECONCILING_ADMISSION_BACKOFF_MS[attempt];
      if (delay === undefined) {
        return;
      }
      admitBackoffTimerRef.current = globalThis.setTimeout(() => {
        admitBackoffTimerRef.current = null;
        if (sessionRef.current !== sessionId || hostReadyRef.current !== true) {
          return;
        }
        if (admissionRef.current === 'ready') {
          return;
        }
        // Defer while a turn is live; keep the same attempt slot.
        if (runLiveRef.current) {
          scheduleReconcilingAdmitBackoff(sessionId);
          return;
        }
        admitBackoffAttemptRef.current = attempt + 1;
        // Call admit directly — re-dispatching `reconciling` would not re-fire
        // the selection effect when already reconciling.
        const generation = selectionGenerationRef.current + 1;
        selectionGenerationRef.current = generation;
        admitSelectedSessionRef.current(sessionId, generation);
      }, delay);
    },
    [clearAdmitBackoffTimer],
  );

  const admitSelectedSession = useCallback(
    (sessionId: string, generation: number): void => {
      dispatch({ type: 'foreground/admission', admission: 'reconciling' });
      if (hostClient.supportsCommand?.('session/foreground-run') === false) {
        admitBackoffAttemptRef.current = 0;
        clearAdmitBackoffTimer();
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
            // Host still up → stay reconciling and backoff. Host down → unknown.
            if (hostReadyRef.current === true) {
              dispatch({ type: 'foreground/admission', admission: 'reconciling' });
              scheduleReconcilingAdmitBackoff(sessionId);
            } else {
              dispatch({ type: 'foreground/admission', admission: 'unknown' });
            }
            return;
          }
          const run =
            (response.data as { run?: ExecutionRunRecord | null } | undefined)?.run ?? null;
          if (run && isRunActive(run.status)) {
            dispatch({ type: 'run/updated', run });
          } else if (!runLiveRef.current) {
            // Idle leftover sidebar spinners only. While a turn is live (including
            // paint-first before ACK), a null snapshot is a race.
            dispatch({ type: 'run/stale-clear', sessionId });
          }
          admitBackoffAttemptRef.current = 0;
          clearAdmitBackoffTimer();
          dispatch({ type: 'foreground/admission', admission: 'ready' });
        })
        .catch(() => {
          if (selectionGenerationRef.current !== generation || sessionRef.current !== sessionId) {
            return;
          }
          if (hostReadyRef.current === true) {
            dispatch({ type: 'foreground/admission', admission: 'reconciling' });
            scheduleReconcilingAdmitBackoff(sessionId);
          } else {
            dispatch({ type: 'foreground/admission', admission: 'unknown' });
          }
        });
    },
    [clearAdmitBackoffTimer, dispatch, hostClient, scheduleReconcilingAdmitBackoff],
  );
  admitSelectedSessionRef.current = admitSelectedSession;
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
    hostClient.registerSequenceGapHandler(() => {
      void reconcilePendingPermissions({ hostClient, dispatch });
      schedule('live');
    });
    return () => hostClient.registerSequenceGapHandler(null);
  }, [dispatch, hostClient, schedule]);

  useEffect(() => {
    // The prompt acknowledgement establishes the Run id before the provider
    // can finish. Give the Host a few bounded turns to publish its terminal
    // record. This covers a dropped terminal push without adding a background
    // polling loop or delaying normal tokens.
    if (!args.runLive || args.activeRunId === null) {
      return;
    }
    let cancelled = false;
    const timers = POST_ADMISSION_RECONCILE_DELAYS_MS.map((delay) =>
      globalThis.setTimeout(() => {
        if (!cancelled) {
          schedule('live');
        }
      }, delay),
    );
    return () => {
      cancelled = true;
      for (const timer of timers) {
        globalThis.clearTimeout(timer);
      }
    };
  }, [args.activeRunId, args.runLive, schedule]);

  useEffect(() => {
    admitBackoffAttemptRef.current = 0;
    clearAdmitBackoffTimer();
  }, [args.activeSessionId, clearAdmitBackoffTimer]);

  useEffect(() => {
    const sessionId = args.activeSessionId;
    if (!sessionId) {
      clearAdmitBackoffTimer();
      dispatch({ type: 'foreground/admission', admission: 'unknown' });
      return;
    }
    // `ready` finished this selection. `unknown` waits for hostReady.
    // `reconciling` (including same-id session/set and backoff retries) admits.
    if (args.foregroundAdmission === 'ready' || args.foregroundAdmission === 'unknown') {
      return;
    }
    const generation = selectionGenerationRef.current + 1;
    selectionGenerationRef.current = generation;
    admitSelectedSession(sessionId, generation);
  }, [
    admitSelectedSession,
    args.activeSessionId,
    args.foregroundAdmission,
    clearAdmitBackoffTimer,
    dispatch,
  ]);

  useEffect(() => {
    const recoverIfHostUpButUnknown = (): void => {
      const sessionId = sessionRef.current;
      if (!sessionId || hostReadyRef.current !== true || admissionRef.current !== 'unknown') {
        return;
      }
      if (runLiveRef.current) {
        return;
      }
      admitBackoffAttemptRef.current = 0;
      clearAdmitBackoffTimer();
      dispatch({ type: 'foreground/admission', admission: 'reconciling' });
    };
    const handleFocus = (): void => {
      schedule('live');
      recoverIfHostUpButUnknown();
    };
    const handleVisibility = (): void => {
      if (document.visibilityState === 'visible') {
        schedule('live');
        recoverIfHostUpButUnknown();
      }
    };
    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [clearAdmitBackoffTimer, dispatch, schedule]);

  useEffect(() => {
    return () => {
      clearAdmitBackoffTimer();
    };
  }, [clearAdmitBackoffTimer]);

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
