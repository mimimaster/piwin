/**
 * Turn-change data and actions for the transcript.
 *
 * Rows ask for their turn's runIds; requests are batched into one
 * `turn-changes/list-by-runs` per session and tick. `turn-changes/updated`
 * pushes (sealing, undo, redo) keep summaries current without polling.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import type {
  HostPush,
  TurnChangeCheck,
  TurnChangeFileDiff,
  TurnChangeFileEntry,
  TurnChangeFilePage,
  TurnChangeOperationProgress,
  TurnChangePathConflict,
  TurnChangeSummary,
} from '@piwin/contracts';
import {
  applyTurnChangeSummaries,
  EMPTY_TURN_CHANGE_INDEX,
  selectTurnChangeSummaries,
  type TurnChangeIndex,
} from './turn-change-index.js';
import {
  cancelTurnChangeOperation,
  runTurnChangeGesture,
  type SubscribeConnected,
  type TurnChangeActionResult,
  type TurnChangeGestureEvent,
  type TurnChangeRefusal,
  type TurnChangesRequest,
} from './turn-change-gesture.js';

export type { TurnChangeActionResult, TurnChangesRequest } from './turn-change-gesture.js';

/** The running undo/redo of a change set, as pushes report it. */
export type TurnChangeLiveOperation = {
  operationId: string;
  progress: TurnChangeOperationProgress | null;
};

export type TurnChangesApi = {
  index: TurnChangeIndex;
  ensureRuns(sessionId: string, runIds: readonly string[]): void;
  run(
    summary: TurnChangeSummary,
    direction: 'undo' | 'redo',
    onEvent?: (event: TurnChangeGestureEvent) => void,
  ): Promise<TurnChangeActionResult>;
  /** Stop a running undo/redo; only honored before its first write. */
  cancel(operationId: string): Promise<'cancelled' | 'write-started' | 'finished' | 'failed'>;
  /** Running operation per change set (from operation-updated pushes). */
  live: ReadonlyMap<string, TurnChangeLiveOperation>;
  check(summary: TurnChangeSummary, direction: 'undo' | 'redo'): Promise<TurnChangeCheck | null>;
  files(summary: TurnChangeSummary): Promise<TurnChangeFileEntry[]>;
  diff(summary: TurnChangeSummary, fileId: string, against?: 'sealed' | 'current'): Promise<TurnChangeFileDiff>;
  /** The turn the right panel's 「本轮变更」 shows; null when none was opened. */
  focusedChangeSetId: string | null;
  /** Bumps on every focusChangeSet, so re-opening the same turn still switches tabs. */
  focusRequest: number;
  /** Open a turn in the right panel (查看变更 on its card). */
  focusChangeSet(changeSetId: string | null): void;
  /** The blocked paths a card's 查看冲突 put in the panel, per change set. */
  conflicts: ReadonlyMap<string, TurnChangeConflictView>;
  /** Show a refusal's paths in the panel (or clear it with null). */
  showConflict(changeSetId: string, view: TurnChangeConflictView | null): void;
  /** Scroll the transcript to another turn's card (定位到后续轮次). */
  revealChangeSet(changeSetId: string): boolean;
};

export type TurnChangeConflictView = {
  direction: 'undo' | 'redo';
  reason: TurnChangeRefusal;
  conflicts: TurnChangePathConflict[];
};

const TurnChangesContext = createContext<TurnChangesApi | null>(null);

/** Coalesce the rows mounted in one render into a single request per session. */
const BATCH_DELAY_MS = 30;

export function TurnChangesProvider(props: {
  request: TurnChangesRequest;
  subscribePush: (listener: (push: HostPush) => void) => () => void;
  /** Connection state, so a gesture cut off by a disconnect can resend its key. */
  subscribeConnected?: SubscribeConnected;
  /** Called after focusChangeSet, so the shell can open the review tab. */
  onFocusChangeSet?: (changeSetId: string) => void;
  children: ReactNode;
}): ReactElement {
  const [index, setIndex] = useState<TurnChangeIndex>(EMPTY_TURN_CHANGE_INDEX);
  const [live, setLive] = useState<ReadonlyMap<string, TurnChangeLiveOperation>>(new Map());
  const [focusedChangeSetId, setFocusedChangeSetId] = useState<string | null>(null);
  const [focusRequest, setFocusRequest] = useState(0);
  const onFocusRef = useRef(props.onFocusChangeSet);
  onFocusRef.current = props.onFocusChangeSet;
  const requestRef = useRef(props.request);
  requestRef.current = props.request;
  const connectedRef = useRef(props.subscribeConnected);
  connectedRef.current = props.subscribeConnected;
  const requested = useRef(new Set<string>());
  const pending = useRef(new Map<string, Set<string>>());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const merge = useCallback((summaries: readonly TurnChangeSummary[]) => {
    if (summaries.length > 0) setIndex((current) => applyTurnChangeSummaries(current, summaries));
  }, []);

  useEffect(
    () =>
      props.subscribePush((push) => {
        if (push.type === 'turn-changes/updated') {
          merge([push.summary]);
          // An operation is live only while the summary says so (any client's).
          const restoring =
            (!push.summary.undo.allowed && push.summary.undo.reason === 'workspace-restoring') ||
            (!push.summary.redo.allowed && push.summary.redo.reason === 'workspace-restoring');
          if (!restoring) {
            setLive((current) => {
              if (!current.has(push.changeSetId)) return current;
              const next = new Map(current);
              next.delete(push.changeSetId);
              return next;
            });
          }
        } else if (push.type === 'turn-changes/operation-updated') {
          setLive((current) => {
            const previous = current.get(push.changeSetId);
            const progress =
              push.progress ?? (previous?.operationId === push.operationId ? previous.progress : null);
            const next = new Map(current);
            next.set(push.changeSetId, { operationId: push.operationId, progress });
            return next;
          });
        }
      }),
    [merge, props.subscribePush],
  );

  const flush = useCallback(() => {
    timer.current = null;
    const batches = [...pending.current.entries()];
    pending.current.clear();
    for (const [sessionId, runIds] of batches) {
      void requestRef
        .current({ type: 'turn-changes/list-by-runs', sessionId, runIds: [...runIds] })
        .then((response) => {
          if (response.success) {
            merge((response.data as { summaries: TurnChangeSummary[] }).summaries);
          }
        })
        .catch((error: unknown) => {
          // Rows fall back to the per-call file summary; a later push still lands.
          console.warn('[turn-changes] list-by-runs failed', error);
          for (const runId of runIds) requested.current.delete(`${sessionId}\n${runId}`);
        });
    }
  }, [merge]);

  const ensureRuns = useCallback(
    (sessionId: string, runIds: readonly string[]) => {
      for (const runId of runIds) {
        const key = `${sessionId}\n${runId}`;
        if (requested.current.has(key)) continue;
        requested.current.add(key);
        let batch = pending.current.get(sessionId);
        if (!batch) {
          batch = new Set();
          pending.current.set(sessionId, batch);
        }
        batch.add(runId);
      }
      if (pending.current.size > 0 && timer.current === null) {
        timer.current = setTimeout(flush, BATCH_DELAY_MS);
      }
    },
    [flush],
  );

  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );

  const run = useCallback(
    async (
      summary: TurnChangeSummary,
      direction: 'undo' | 'redo',
      onEvent?: (event: TurnChangeGestureEvent) => void,
    ): Promise<TurnChangeActionResult> => {
      const result = await runTurnChangeGesture({
        request: (command, options) => requestRef.current(command, options),
        subscribeConnected: connectedRef.current,
        summary,
        direction,
        ...(onEvent ? { onEvent } : {}),
      });
      // The operation is over either way; drop its live entry.
      setLive((current) => {
        if (!current.has(summary.changeSetId)) return current;
        const next = new Map(current);
        next.delete(summary.changeSetId);
        return next;
      });
      return result;
    },
    [],
  );

  const cancel = useCallback(
    (operationId: string) => cancelTurnChangeOperation((command, options) => requestRef.current(command, options), operationId),
    [],
  );

  const check = useCallback(
    async (summary: TurnChangeSummary, direction: 'undo' | 'redo'): Promise<TurnChangeCheck | null> => {
      const response = await requestRef.current({
        type: 'turn-changes/check',
        changeSetId: summary.changeSetId,
        revision: summary.revision,
        direction,
      });
      return response.success ? (response.data as TurnChangeCheck) : null;
    },
    [],
  );

  const files = useCallback(async (summary: TurnChangeSummary): Promise<TurnChangeFileEntry[]> => {
    const collected: TurnChangeFileEntry[] = [];
    let cursor: string | null = null;
    do {
      const response = await requestRef.current({
        type: 'turn-changes/files',
        changeSetId: summary.changeSetId,
        revision: summary.revision,
        ...(cursor !== null ? { cursor } : {}),
      });
      if (!response.success) throw new Error(response.error);
      const page = response.data as TurnChangeFilePage;
      collected.push(...page.files);
      cursor = page.nextCursor;
    } while (cursor !== null);
    return collected;
  }, []);

  const diff = useCallback(
    async (summary: TurnChangeSummary, fileId: string, against?: 'sealed' | 'current'): Promise<TurnChangeFileDiff> => {
      const response = await requestRef.current({
        type: 'turn-changes/diff',
        changeSetId: summary.changeSetId,
        revision: summary.revision,
        fileId,
        ...(against === 'current' ? { against } : {}),
      });
      if (!response.success) throw new Error(response.error);
      return response.data as TurnChangeFileDiff;
    },
    [],
  );

  const focusChangeSet = useCallback((changeSetId: string | null) => {
    setFocusedChangeSetId(changeSetId);
    if (changeSetId !== null) {
      setFocusRequest((count) => count + 1);
      onFocusRef.current?.(changeSetId);
    }
  }, []);

  const [conflicts, setConflicts] = useState<ReadonlyMap<string, TurnChangeConflictView>>(new Map());
  const showConflict = useCallback(
    (changeSetId: string, view: TurnChangeConflictView | null) => {
      setConflicts((current) => {
        if (view === null && !current.has(changeSetId)) return current;
        const next = new Map(current);
        if (view === null) next.delete(changeSetId);
        else next.set(changeSetId, view);
        return next;
      });
      if (view !== null) focusChangeSet(changeSetId);
    },
    [focusChangeSet],
  );

  const revealChangeSet = useCallback((changeSetId: string): boolean => {
    const card = document.querySelector<HTMLElement>(
      `[data-testid="turn-change-bar"][data-change-set-id="${CSS.escape(changeSetId)}"]`,
    );
    if (!card || card.closest('[data-testid="turn-change-panel"]')) return false;
    card.scrollIntoView({ block: 'center', behavior: 'smooth' });
    card.classList.add('turn-change-bar-revealed');
    window.setTimeout(() => card.classList.remove('turn-change-bar-revealed'), 1600);
    return true;
  }, []);

  const value = useMemo<TurnChangesApi>(
    () => ({
      index,
      ensureRuns,
      run,
      cancel,
      live,
      check,
      files,
      diff,
      focusedChangeSetId,
      focusRequest,
      focusChangeSet,
      conflicts,
      showConflict,
      revealChangeSet,
    }),
    [
      index,
      ensureRuns,
      run,
      cancel,
      live,
      check,
      files,
      diff,
      focusedChangeSetId,
      focusRequest,
      focusChangeSet,
      conflicts,
      showConflict,
      revealChangeSet,
    ],
  );
  return <TurnChangesContext.Provider value={value}>{props.children}</TurnChangesContext.Provider>;
}

export function useTurnChangesApi(): TurnChangesApi | null {
  return useContext(TurnChangesContext);
}

/** This turn's change sets, fetched on first mount and kept current by pushes. */
export function useTurnChangeSummaries(
  sessionId: string | undefined,
  runIds: readonly string[],
): TurnChangeSummary[] {
  const api = useTurnChangesApi();
  const runKey = runIds.join('\n');
  useEffect(() => {
    if (api && sessionId && runIds.length > 0) api.ensureRuns(sessionId, runIds);
    // runKey carries runIds' content.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api?.ensureRuns, sessionId, runKey]);
  const index = api?.index;
  return useMemo(
    () => (index ? selectTurnChangeSummaries(index, runIds) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [index, runKey],
  );
}
