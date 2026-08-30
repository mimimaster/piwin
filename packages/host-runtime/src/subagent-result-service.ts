/** In-memory subagent result store, apply mutex, and parent-resolution text. */

import { randomUUID } from 'node:crypto';
import type { SubagentResultSummary } from '@piwin/contracts';
import {
  diffTurnChangeObjects,
  type TurnChangeObjectStore,
  type TurnChangeStore,
} from '@piwin/git';

export const SUBAGENT_RESOLUTION_INSTRUCTION =
  '请检查子任务尚未合入的结果，在保留当前修改的前提下处理冲突并验证；不要扩大原任务范围';

const DEFAULT_LIST_LIMIT = 50;
const MAX_LIST_LIMIT = 200;
const CLEANUP_TTL_MS = 5 * 60 * 1000;

export type SubagentResultListQuery = {
  parentSessionId: string;
  attemptId?: string;
  pendingOnly?: boolean;
  cursor?: string;
  limit?: number;
};

export type SubagentResultListPage = {
  items: SubagentResultSummary[];
  nextCursor?: string;
};

export type SubagentResultFilePageItem = {
  fileId: string;
  relativePath: string;
  kind: 'added' | 'modified' | 'deleted';
};

export type SubagentResultFilesPage = {
  files: SubagentResultFilePageItem[];
  nextCursor?: string;
};

export type SubagentResultApplyInput = {
  resultId: string;
  expectedRevision: number;
  applyResult: (input: { resultId: string; expectedRevision: number }) => Promise<{
    operationId: string;
  }>;
};

export type SubagentResultApplyOutcome =
  | { ok: true; operationId: string }
  | {
      ok: false;
      code: 'not-found' | 'stale-revision' | 'already-applied' | 'candidate-group-selected';
      alreadyApplied?: boolean;
    };

export type SubagentResultResolutionInput = {
  resultId: string;
  expectedRevision: number;
  purpose: 'resolve' | 'verify';
  startParentPrompt: (input: {
    parentSessionId: string;
    text: string;
    resultId: string;
  }) => Promise<{ runId: string }>;
};

export type SubagentResultResolutionOutcome =
  | { ok: true; runId: string }
  | { ok: false; code: 'not-found' | 'stale-revision' };

export type SubagentResultDiffOutcome =
  | {
      ok: true;
      additions: number | null;
      deletions: number | null;
      binary: boolean;
      patch?: string;
    }
  | { ok: false; code: 'not-found' };

export type SubagentResultCleanupOutcome =
  | { ok: true; worktreePath: string; token: string; expiresAt: string }
  | { ok: false; code: 'not-found' | 'stale-revision' };

export type SubagentResultServiceOptions = {
  changeStore?: Pick<TurnChangeStore, 'getChangeVersion'>;
  objectStore?: TurnChangeObjectStore;
};

export type SubagentResultService = {
  register(summary: SubagentResultSummary, extras?: { worktreePath?: string }): void;
  get(resultId: string): SubagentResultSummary | undefined;
  list(query: SubagentResultListQuery): SubagentResultListPage;
  listFiles(query: {
    resultId: string;
    revision: number;
    cursor?: string;
    limit?: number;
  }): SubagentResultFilesPage;
  diffFile(query: {
    resultId: string;
    revision: number;
    fileId: string;
  }): Promise<SubagentResultDiffOutcome>;
  apply(input: SubagentResultApplyInput): Promise<SubagentResultApplyOutcome>;
  requestResolution(
    input: SubagentResultResolutionInput,
  ): Promise<SubagentResultResolutionOutcome>;
  planCleanup(resultId: string, expectedRevision: number): SubagentResultCleanupOutcome;
};

type StoredExtras = { worktreePath?: string };

export function createSubagentResultService(
  options: SubagentResultServiceOptions = {},
): SubagentResultService {
  const order: string[] = [];
  const byId = new Map<string, SubagentResultSummary>();
  const extrasById = new Map<string, StoredExtras>();
  const appliedByResultId = new Map<string, string>();
  const selectedGroupId = new Map<string, string>();
  const serializeApply = createSerializer();

  function lookup(
    resultId: string,
    expectedRevision: number,
  ): { ok: true; summary: SubagentResultSummary } | { ok: false; code: 'not-found' | 'stale-revision' } {
    const summary = byId.get(resultId);
    if (!summary) return { ok: false, code: 'not-found' };
    if (summary.revision !== expectedRevision) return { ok: false, code: 'stale-revision' };
    return { ok: true, summary };
  }

  return {
    register(summary, extras) {
      if (!byId.has(summary.resultId)) {
        order.push(summary.resultId);
      }
      byId.set(summary.resultId, summary);
      if (extras !== undefined) {
        extrasById.set(summary.resultId, extras);
      }
    },

    get(resultId) {
      return byId.get(resultId);
    },

    list(query) {
      const filtered: SubagentResultSummary[] = [];
      for (const resultId of order) {
        const summary = byId.get(resultId);
        if (!summary || summary.parentSessionId !== query.parentSessionId) continue;
        if (query.attemptId !== undefined && summary.sourceAttemptId !== query.attemptId) continue;
        if (query.pendingOnly === true && !isPending(summary)) continue;
        filtered.push(summary);
      }
      return pageById(filtered, query.cursor, query.limit, (item) => item.resultId, 'items');
    },

    listFiles(query) {
      const summary = byId.get(query.resultId);
      const changeSetId = summary?.childChanges?.changeSetId;
      const version =
        changeSetId === undefined
          ? undefined
          : options.changeStore?.getChangeVersion(changeSetId, query.revision);
      const files = (version?.files ?? []).map((file) => ({
        fileId: file.fileId,
        relativePath: file.relativePath,
        kind: file.kind,
      }));
      return pageById(files, query.cursor, query.limit, (item) => item.fileId, 'files');
    },

    async diffFile(query) {
      const summary = byId.get(query.resultId);
      if (!summary) return { ok: false, code: 'not-found' };
      const changeSetId = summary.childChanges?.changeSetId;
      const version =
        changeSetId === undefined
          ? undefined
          : options.changeStore?.getChangeVersion(changeSetId, query.revision);
      const objectStore = options.objectStore;
      if (version === undefined || objectStore === undefined) {
        return { ok: true, additions: 0, deletions: 0, binary: false };
      }
      const file = version.files.find((entry) => entry.fileId === query.fileId);
      if (file === undefined) return { ok: false, code: 'not-found' };
      const diff = await diffTurnChangeObjects({
        store: objectStore,
        beforeSha: file.beforeSha,
        afterSha: file.afterSha,
        pathLabel: file.relativePath,
      });
      return {
        ok: true,
        additions: diff.additions,
        deletions: diff.deletions,
        binary: diff.binary,
        ...(diff.patch === undefined ? {} : { patch: diff.patch }),
      };
    },

    apply(input) {
      return serializeApply(async () => {
        const found = lookup(input.resultId, input.expectedRevision);
        if (!found.ok) return found;
        if (appliedByResultId.has(input.resultId)) {
          return { ok: false, code: 'already-applied', alreadyApplied: true };
        }
        const groupId = found.summary.candidateGroupId;
        if (groupId !== null && selectedGroupId.has(groupId)) {
          return { ok: false, code: 'candidate-group-selected' };
        }
        const applied = await input.applyResult({
          resultId: input.resultId,
          expectedRevision: input.expectedRevision,
        });
        appliedByResultId.set(input.resultId, applied.operationId);
        if (groupId !== null) {
          selectedGroupId.set(groupId, input.resultId);
        }
        byId.set(input.resultId, {
          ...found.summary,
          integrationStatus: 'applied',
          latestOperationId: applied.operationId,
        });
        return { ok: true, operationId: applied.operationId };
      });
    },

    async requestResolution(input) {
      const found = lookup(input.resultId, input.expectedRevision);
      if (!found.ok) return found;
      const accepted = await input.startParentPrompt({
        parentSessionId: found.summary.parentSessionId,
        resultId: input.resultId,
        text: buildResolutionText(found.summary, input.purpose),
      });
      return { ok: true, runId: accepted.runId };
    },

    planCleanup(resultId, expectedRevision) {
      const found = lookup(resultId, expectedRevision);
      if (!found.ok) return found;
      const extras = extrasById.get(resultId);
      return {
        ok: true,
        worktreePath: extras?.worktreePath ?? '',
        token: randomUUID(),
        expiresAt: new Date(Date.now() + CLEANUP_TTL_MS).toISOString(),
      };
    },
  };
}

function isPending(summary: SubagentResultSummary): boolean {
  return summary.integrationStatus !== 'applied' && summary.integrationStatus !== 'discarded';
}

function buildResolutionText(
  summary: SubagentResultSummary,
  purpose: 'resolve' | 'verify',
): string {
  return `子任务 ${summary.taskId}（${purpose}）。${SUBAGENT_RESOLUTION_INSTRUCTION}`;
}

function resolveLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return DEFAULT_LIST_LIMIT;
  return Math.min(Math.max(Math.trunc(limit), 0), MAX_LIST_LIMIT);
}

function pageById<T>(
  items: readonly T[],
  cursor: string | undefined,
  limit: number | undefined,
  idOf: (item: T) => string,
  key: 'items',
): { items: T[]; nextCursor?: string };
function pageById<T>(
  items: readonly T[],
  cursor: string | undefined,
  limit: number | undefined,
  idOf: (item: T) => string,
  key: 'files',
): { files: T[]; nextCursor?: string };
function pageById<T>(
  items: readonly T[],
  cursor: string | undefined,
  limit: number | undefined,
  idOf: (item: T) => string,
  key: 'items' | 'files',
): { items?: T[]; files?: T[]; nextCursor?: string } {
  const resolvedLimit = resolveLimit(limit);
  let start = 0;
  if (cursor !== undefined && cursor.length > 0) {
    const index = items.findIndex((item) => idOf(item) === cursor);
    start = index === -1 ? items.length : index + 1;
  }
  const page = items.slice(start, start + resolvedLimit);
  const last = page[page.length - 1];
  const nextCursor =
    last !== undefined && start + page.length < items.length ? idOf(last) : undefined;
  const body = key === 'files' ? { files: page } : { items: page };
  return nextCursor === undefined ? body : { ...body, nextCursor };
}

function createSerializer(): <T>(fn: () => Promise<T>) => Promise<T> {
  let tail: Promise<void> = Promise.resolve();
  return (fn) => {
    const run = tail.then(fn, fn);
    tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };
}
