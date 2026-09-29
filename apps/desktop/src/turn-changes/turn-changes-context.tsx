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
  HostCommand,
  HostPush,
  HostResponse,
  TurnChangeCheck,
  TurnChangeFileDiff,
  TurnChangeFileEntry,
  TurnChangeFilePage,
  TurnChangeSummary,
} from '@piwin/contracts';
import { createIdempotencyKey } from '@piwin/host-client';
import {
  applyTurnChangeSummaries,
  EMPTY_TURN_CHANGE_INDEX,
  selectTurnChangeSummaries,
  type TurnChangeIndex,
} from './turn-change-index.js';

export type TurnChangesRequest = (
  command: HostCommand,
  options?: { idempotencyKey?: string },
) => Promise<HostResponse>;

export type TurnChangeActionResult =
  | { kind: 'done' }
  | { kind: 'conflict'; affectedPaths: string[] }
  | { kind: 'error'; message: string };

export type TurnChangesApi = {
  index: TurnChangeIndex;
  ensureRuns(sessionId: string, runIds: readonly string[]): void;
  run(summary: TurnChangeSummary, direction: 'undo' | 'redo'): Promise<TurnChangeActionResult>;
  check(summary: TurnChangeSummary, direction: 'undo' | 'redo'): Promise<TurnChangeCheck | null>;
  files(summary: TurnChangeSummary): Promise<TurnChangeFileEntry[]>;
  diff(summary: TurnChangeSummary, fileId: string): Promise<TurnChangeFileDiff>;
};

const TurnChangesContext = createContext<TurnChangesApi | null>(null);

/** Coalesce the rows mounted in one render into a single request per session. */
const BATCH_DELAY_MS = 30;

export function TurnChangesProvider(props: {
  request: TurnChangesRequest;
  subscribePush: (listener: (push: HostPush) => void) => () => void;
  children: ReactNode;
}): ReactElement {
  const [index, setIndex] = useState<TurnChangeIndex>(EMPTY_TURN_CHANGE_INDEX);
  const requestRef = useRef(props.request);
  requestRef.current = props.request;
  const requested = useRef(new Set<string>());
  const pending = useRef(new Map<string, Set<string>>());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const merge = useCallback((summaries: readonly TurnChangeSummary[]) => {
    if (summaries.length > 0) setIndex((current) => applyTurnChangeSummaries(current, summaries));
  }, []);

  useEffect(
    () =>
      props.subscribePush((push) => {
        if (push.type === 'turn-changes/updated') merge([push.summary]);
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
    async (summary: TurnChangeSummary, direction: 'undo' | 'redo'): Promise<TurnChangeActionResult> => {
      try {
        const response = await requestRef.current(
          {
            type: direction === 'undo' ? 'turn-changes/undo' : 'turn-changes/redo',
            changeSetId: summary.changeSetId,
            expectedRevision: summary.revision,
          },
          // One click is one gesture: the Host applies it at most once.
          { idempotencyKey: createIdempotencyKey() },
        );
        if (!response.success) {
          return { kind: 'error', message: response.error };
        }
        const data = response.data as { status?: string; reason?: string; affectedPaths?: string[] };
        if (data.status === 'succeeded') return { kind: 'done' };
        if (data.reason === 'files-changed') {
          return { kind: 'conflict', affectedPaths: data.affectedPaths ?? [] };
        }
        return { kind: 'error', message: data.reason ?? data.status ?? 'unknown' };
      } catch (error) {
        return { kind: 'error', message: error instanceof Error ? error.message : String(error) };
      }
    },
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

  const diff = useCallback(async (summary: TurnChangeSummary, fileId: string): Promise<TurnChangeFileDiff> => {
    const response = await requestRef.current({
      type: 'turn-changes/diff',
      changeSetId: summary.changeSetId,
      revision: summary.revision,
      fileId,
    });
    if (!response.success) throw new Error(response.error);
    return response.data as TurnChangeFileDiff;
  }, []);

  const value = useMemo<TurnChangesApi>(
    () => ({ index, ensureRuns, run, check, files, diff }),
    [index, ensureRuns, run, check, files, diff],
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
