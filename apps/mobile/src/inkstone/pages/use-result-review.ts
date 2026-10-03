import { useEffect, useMemo, useRef, useState } from 'react';
import type { HostClient } from '@piwin/host-client';
import type { HostCommand, HostResponse } from '@piwin/contracts';
import { toError } from '../../mobile-host-helpers.js';
import {
  advanceCursor, FILE_PAGE_SIZE, readDiff, readFiles, readResults, readVerification,
  relevantReviewPush, resultKey, RESULT_PAGE_SIZE,
  type ReviewDiff, type ReviewFile, type ReviewResult, type VerificationStatus,
} from './review-model.js';

export type ReviewSnapshot = {
  results: ReviewResult[];
  result?: ReviewResult | undefined;
  resultCursor?: string | undefined;
  files: ReviewFile[];
  fileCursor?: string | undefined;
  fileId?: string | undefined;
  diff?: ReviewDiff | undefined;
  verification?: VerificationStatus | undefined;
  resultsLoading: boolean;
  filesLoading: boolean;
  diffLoading: boolean;
  verificationLoading: boolean;
  stale: boolean;
  disconnected: boolean;
  resultsError?: string | undefined;
  filesError?: string | undefined;
  diffError?: string | undefined;
  verificationError?: string | undefined;
};
function empty(): ReviewSnapshot {
  return { results: [], files: [], resultsLoading: false, filesLoading: false,
    diffLoading: false, verificationLoading: false, stale: false, disconnected: false };
}
type ReviewActions = {
  selectResult: (key: string) => void;
  selectFile: (id: string) => void;
  moreResults: () => void;
  moreFiles: () => void;
  refresh: () => void;
};

/** Mount-local public snapshots only; every asynchronous branch has an ownership/generation guard. */
export function useResultReview(client: HostClient | undefined, sessionId: string | undefined, ready: boolean) {
  const [pendingOnly, setPendingOnly] = useState(true);
  const scope = useMemo(() => ({}), [client, sessionId, ready, pendingOnly]);
  const [stored, setStored] = useState<{ scope: object; snapshot: ReviewSnapshot }>(() => ({ scope, snapshot: empty() }));
  const actions = useRef<ReviewActions | undefined>(undefined);
  const liveScope = useRef(scope);
  liveScope.current = scope;

  useEffect(() => {
    let alive = true;
    let connected = ready;
    let generation = 0;
    let filesGeneration = 0;
    let diffGeneration = 0;
    let verificationGeneration = 0;
    let snapshot = empty();
    let resultPages = 1;
    let resultBusy = false;
    let refreshQueued = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let resultCursors = new Set<string>();
    let fileCursors = new Set<string>();
    const owned = () => alive && liveScope.current === scope;
    const valid = (token: number) => owned() && connected && token === generation;
    const update = (patch: Partial<ReviewSnapshot>) => {
      if (!owned()) return;
      snapshot = { ...snapshot, ...patch };
      setStored({ scope, snapshot });
    };
    const invalidate = () => {
      generation += 1;
      filesGeneration += 1;
      diffGeneration += 1;
      verificationGeneration += 1;
      update({ stale: true, files: [], fileCursor: undefined, diff: undefined, verification: undefined,
        filesLoading: false, diffLoading: false, verificationLoading: false });
    };
    const read = async (command: HostCommand): Promise<HostResponse> => {
      if (client === undefined || !connected) throw new Error('Host 已断开；旧快照不可作为当前状态。');
      if (!client.supportsCommand(command.type)) throw new Error(`Host 未开放 ${command.type} 只读读取。`);
      return client.request(command);
    };
    const detailValid = (token: number, result: ReviewResult) => valid(token) &&
      snapshot.result !== undefined && resultKey(snapshot.result) === resultKey(result);

    const loadDiff = async (fileId: string): Promise<void> => {
      const result = snapshot.result;
      if (result === undefined || snapshot.stale || !snapshot.files.some((file) => file.fileId === fileId)) return;
      const token = generation;
      const ticket = ++diffGeneration;
      update({ fileId, diff: undefined, diffLoading: true, diffError: undefined });
      try {
        const diff = readDiff(await read({ type: 'subagent/result-diff', resultId: result.resultId, revision: result.revision, fileId }));
        if (detailValid(token, result) && ticket === diffGeneration) update({ diff, diffLoading: false });
      } catch (error) {
        if (detailValid(token, result) && ticket === diffGeneration) update({ diffLoading: false, diffError: toError(error).message });
      }
    };
    const loadVerification = async (result: ReviewResult): Promise<void> => {
      const token = generation;
      const ticket = ++verificationGeneration;
      update({ verification: undefined, verificationError: undefined, verificationLoading: false });
      if (result.latestVerification === undefined || result.batchRunId === undefined) return;
      update({ verificationLoading: true });
      try {
        const verification = readVerification(await read({ type: 'subagent/batch-status', runId: result.batchRunId }), result);
        if (detailValid(token, result) && ticket === verificationGeneration) update({ verification, verificationLoading: false });
      } catch (error) {
        if (detailValid(token, result) && ticket === verificationGeneration) update({ verificationLoading: false, verificationError: toError(error).message });
      }
    };
    const loadFiles = async (append: boolean): Promise<void> => {
      const result = snapshot.result;
      if (result === undefined || snapshot.stale || (append && (snapshot.filesLoading || snapshot.fileCursor === undefined))) return;
      const token = generation;
      const ticket = ++filesGeneration;
      const cursor = append ? snapshot.fileCursor : undefined;
      if (!append) fileCursors = new Set();
      update({ filesLoading: true, filesError: undefined });
      try {
        const page = readFiles(await read({ type: 'subagent/result-files', resultId: result.resultId,
          revision: result.revision, limit: FILE_PAGE_SIZE, ...(cursor !== undefined ? { cursor } : {}) }));
        if (!detailValid(token, result) || ticket !== filesGeneration) return;
        const nextCursor = advanceCursor(page.nextCursor, fileCursors);
        const files = append ? [...snapshot.files] : [];
        for (const file of page.items) if (!files.some((old) => old.fileId === file.fileId)) files.push(file);
        update({ files, fileCursor: nextCursor, filesLoading: false,
          fileId: files.some((file) => file.fileId === snapshot.fileId) ? snapshot.fileId : undefined });
      } catch (error) {
        if (detailValid(token, result) && ticket === filesGeneration) update({ filesLoading: false, fileCursor: undefined, filesError: toError(error).message });
      }
    };
    const select = (result: ReviewResult, preserveFile = false) => {
      filesGeneration += 1;
      diffGeneration += 1;
      verificationGeneration += 1;
      update({ result, stale: false, files: [], fileCursor: undefined, diff: undefined,
        fileId: preserveFile ? snapshot.fileId : undefined, verification: undefined,
        filesLoading: false, diffLoading: false, filesError: undefined, diffError: undefined });
      if (result.availability.view?.allowed === false) {
        update({ filesError: result.availability.view.reason ?? 'Host 不允许查看该结果。' });
      } else {
        void loadFiles(false);
      }
      void loadVerification(result);
    };
    const scheduleRefresh = () => {
      refreshQueued = true;
      if (timer !== undefined || resultBusy || !connected || !owned()) return;
      timer = setTimeout(() => {
        timer = undefined;
        void loadResults(false);
      }, 50);
    };
    const loadResults = async (append: boolean): Promise<void> => {
      if (!connected || client === undefined || sessionId === undefined || resultBusy) return;
      if (append && (snapshot.stale || snapshot.resultCursor === undefined)) return;
      resultBusy = true;
      if (!append) refreshQueued = false;
      const token = generation;
      const wantedPages = append ? 1 : resultPages;
      let cursor = append ? snapshot.resultCursor : undefined;
      const seen = append ? new Set(resultCursors) : new Set<string>();
      const results = append ? [...snapshot.results] : [];
      update({ resultsLoading: true, resultsError: undefined });
      try {
        for (let index = 0; index < wantedPages; index += 1) {
          const page = readResults(await read({ type: 'subagent/results', parentSessionId: sessionId,
            pendingOnly, limit: RESULT_PAGE_SIZE, ...(cursor !== undefined ? { cursor } : {}) }), sessionId);
          if (!valid(token)) return;
          cursor = advanceCursor(page.nextCursor, seen);
          for (const result of page.items) {
            const old = results.findIndex((item) => item.resultId === result.resultId);
            if (old === -1) results.push(result); else results[old] = result;
          }
          if (cursor === undefined) break;
        }
        if (!valid(token)) return;
        resultCursors = seen;
        if (append) resultPages += 1;
        const previous = snapshot.result;
        const selected = results.find((item) => item.resultId === previous?.resultId) ?? results[0];
        update({ results, resultCursor: cursor, resultsLoading: false, stale: false });
        if (selected === undefined) {
          update({ result: undefined, files: [], fileId: undefined, diff: undefined, verification: undefined });
        } else if (!append || JSON.stringify(selected) !== JSON.stringify(previous)) {
          select(selected, previous !== undefined && resultKey(previous) === resultKey(selected));
        }
      } catch (error) {
        if (valid(token)) update({ resultsLoading: false, resultCursor: undefined, resultsError: toError(error).message });
      } finally {
        resultBusy = false;
        if (owned() && connected && refreshQueued) scheduleRefresh();
      }
    };
    const controller: ReviewActions = {
      selectResult: (key) => {
        if (!owned() || !connected || snapshot.stale) return;
        const result = snapshot.results.find((item) => resultKey(item) === key);
        if (result !== undefined && resultKey(result) !== (snapshot.result === undefined ? undefined : resultKey(snapshot.result))) select(result);
      },
      selectFile: (id) => { if (owned() && connected) void loadDiff(id); },
      moreResults: () => { if (owned()) void loadResults(true); },
      moreFiles: () => { if (owned() && connected) void loadFiles(true); },
      refresh: () => { if (owned() && connected) { invalidate(); scheduleRefresh(); } },
    };
    actions.current = controller;
    update({ resultsLoading: ready && client !== undefined && sessionId !== undefined });
    const unsubscribePush = client?.subscribePush((push) => {
      if (!owned() || !connected || sessionId === undefined || !relevantReviewPush(push, sessionId)) return;
      invalidate();
      scheduleRefresh();
    });
    const unsubscribeState = client?.subscribeState((state) => {
      if (!owned()) return;
      const next = state.kind === 'ready' && ready;
      if (next === connected) return;
      connected = next;
      invalidate();
      update({ resultsLoading: false, disconnected: !connected });
      if (connected) scheduleRefresh();
    });
    void loadResults(false);
    return () => {
      alive = false;
      generation += 1;
      if (timer !== undefined) clearTimeout(timer);
      unsubscribePush?.();
      unsubscribeState?.();
      if (actions.current === controller) actions.current = undefined;
    };
  }, [client, sessionId, ready, pendingOnly, scope]);

  return {
    snapshot: stored.scope === scope ? stored.snapshot : empty(), pendingOnly, setPendingOnly,
    selectResult: (key: string) => actions.current?.selectResult(key),
    selectFile: (id: string) => actions.current?.selectFile(id),
    moreResults: () => actions.current?.moreResults(), moreFiles: () => actions.current?.moreFiles(),
    refresh: () => actions.current?.refresh(),
  };
}
