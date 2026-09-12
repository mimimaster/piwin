/** Restart-rebuildable subagent result projection. Apply maps are a cache. */

import { randomUUID } from 'node:crypto';
import type { SubagentResultSummary } from '@piwin/contracts';
import {
  diffTurnChangeObjects,
  occupiesSubagentApplyStatus,
  type SubagentApplyReservationRecord,
  type TurnChangeObjectStore,
  type TurnChangeStore,
} from '@piwin/git';
import type { SubagentReviewRecord, SubagentReviewRef } from '@piwin/contracts';
import { applyLineageHeadProjection } from './subagent-result-projection.js';
import {
  evaluateReviewedApplyInvariants,
  isApplyAbortOrTimeoutError,
  isSubagentApplyOutcomeUnknownError,
  SubagentApplyOutcomeUnknownError,
} from './subagent-result-apply.js';
import {
  subagentApplyIdempotencyKey,
  subagentApplyRequestHash,
} from './subagent-apply-reservation.js';

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
  applyResult: (input: {
    resultId: string;
    expectedRevision: number;
    operationId: string;
    signal?: AbortSignal;
  }) => Promise<{
    operationId: string;
    status?: 'succeeded' | 'rejected' | 'needs-repair' | 'workspace-busy';
    integrationStatus?: import('@piwin/contracts').SubagentIntegrationStatus;
  }>;
  principal?: string;
  idempotencyKey?: string;
  requestHash?: string;
  parentSessionId?: string;
  approvedBy?: SubagentReviewRef;
  review?: SubagentReviewRecord;
  signal?: AbortSignal;
};

export type SubagentResultApplyOutcome =
  | { ok: true; operationId: string }
  | {
      ok: false;
      code:
        | 'not-found'
        | 'stale-revision'
        | 'already-applied'
        | 'candidate-group-selected'
        | 'needs-repair'
        | 'review-missing'
        | 'result-not-approved'
        | 'stale-review'
        | 'candidate-superseded'
        | 'review-data-expired'
        | 'review-target-forbidden'
        | 'apply-outcome-unknown'
        | 'workspace-busy';
      alreadyApplied?: boolean;
      operationId?: string;
    };

export type SubagentApplyOperationStore = Pick<
  TurnChangeStore,
  | 'reserveSubagentApply'
  | 'releaseSubagentApplyReservation'
  | 'getOperation'
  | 'getSubagentApplyReservation'
  | 'updateOperationStatus'
  | 'listSubagentApplyReservations'
  | 'hasSubagentApplyWriteCompleted'
>;

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
  operationStore?: SubagentApplyOperationStore;
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
  reconcileApplyReservations(reservations: readonly SubagentApplyReservationRecord[]): void;
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
  const operationStore = options.operationStore;

  function occupy(resultId: string, groupId: string | null, operationId: string): void {
    appliedByResultId.set(resultId, operationId);
    if (groupId !== null) {
      selectedGroupId.set(groupId, resultId);
    }
  }

  function projectApplied(resultId: string, operationId: string): void {
    const summary = byId.get(resultId);
    if (!summary) return;
    byId.set(resultId, {
      ...summary,
      integrationStatus: 'applied',
      latestOperationId: operationId,
      appliedChanges: summary.appliedChanges ?? summary.childChanges,
      availability: {
        ...summary.availability,
        apply: { allowed: false, reason: 'already-applied' },
      },
    });
  }

  function occupyReservation(record: SubagentApplyReservationRecord): void {
    occupy(record.resultId, record.candidateGroupId, record.operationId);
    if (record.status === 'succeeded') {
      projectApplied(record.resultId, record.operationId);
    }
  }

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
      for (const next of applyLineageHeadProjection([...byId.values()])) {
        byId.set(next.resultId, next);
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
        const authorized = evaluateReviewedApplyInvariants({
          summary: found.summary,
          expectedRevision: input.expectedRevision,
          ...(input.parentSessionId ? { parentSessionId: input.parentSessionId } : {}),
          ...(input.approvedBy ? { approvedBy: input.approvedBy } : {}),
          ...(input.review ? { review: input.review } : {}),
          lineageMembers: [...byId.values()].filter(
            (candidate) => candidate.parentSessionId === found.summary.parentSessionId,
          ),
        });
        if (!authorized.ok) return authorized;
        const groupId = found.summary.candidateGroupId;
        if (!operationStore) {
          if (appliedByResultId.has(input.resultId)) {
            return { ok: false, code: 'already-applied', alreadyApplied: true };
          }
          if (groupId !== null && selectedGroupId.has(groupId)) {
            return { ok: false, code: 'candidate-group-selected' };
          }
          const applied = await input.applyResult({
            resultId: input.resultId,
            expectedRevision: input.expectedRevision,
            operationId: `apply-${input.resultId}-${String(input.expectedRevision)}`,
          });
          if (applied.status === 'rejected') {
            return { ok: false, code: 'already-applied', alreadyApplied: false };
          }
          if (applied.status === 'workspace-busy') {
            return { ok: false, code: 'workspace-busy' };
          }
          if (applied.status === 'needs-repair') {
            return { ok: false, code: 'needs-repair' };
          }
          occupy(input.resultId, groupId, applied.operationId);
          projectApplied(input.resultId, applied.operationId);
          return { ok: true, operationId: applied.operationId };
        }

        const reserved = operationStore.reserveSubagentApply({
          operationId: randomUUID(),
          changeSetId:
            found.summary.childChanges?.changeSetId ?? subagentApplyIdempotencyKey(input.resultId),
          expectedRevision: input.expectedRevision,
          principal: input.principal ?? 'host',
          idempotencyKey: input.idempotencyKey ?? subagentApplyIdempotencyKey(input.resultId),
          requestHash:
            input.requestHash ?? subagentApplyRequestHash(input.resultId, input.expectedRevision),
          resultId: input.resultId,
          ...(groupId !== null ? { candidateGroupId: groupId } : {}),
        });
        if (reserved.outcome === 'replay') {
          occupy(input.resultId, groupId, reserved.operationId);
          if (reserved.status === 'succeeded') {
            projectApplied(input.resultId, reserved.operationId);
            return { ok: true, operationId: reserved.operationId };
          }
          if (reserved.status === 'needs-repair') {
            return { ok: false, code: 'needs-repair' };
          }
          if (reserved.status === 'applying') {
            if (operationStore.hasSubagentApplyWriteCompleted(reserved.operationId)) {
              operationStore.updateOperationStatus(reserved.operationId, 'succeeded');
              projectApplied(input.resultId, reserved.operationId);
              return { ok: true, operationId: reserved.operationId };
            }
            return {
              ok: false,
              code: 'apply-outcome-unknown',
              operationId: reserved.operationId,
            };
          }
          return { ok: false, code: 'already-applied', alreadyApplied: reserved.status === 'succeeded' };
        }
        if (reserved.outcome === 'conflict') {
          const existing =
            operationStore.getSubagentApplyReservation({ resultId: input.resultId }) ??
            (groupId !== null
              ? operationStore.getSubagentApplyReservation({ candidateGroupId: groupId })
              : undefined);
          if (existing) occupyReservation(existing);
          return {
            ok: false,
            code: reserved.code,
            alreadyApplied:
              reserved.code === 'already-applied' &&
              operationStore.getOperation(reserved.operationId)?.status === 'succeeded',
          };
        }

        return runReservedWriter(
          operationStore,
          input,
          groupId,
          reserved.operationId,
          occupy,
          projectApplied,
        );
      });
    },

    reconcileApplyReservations(reservations) {
      for (const record of reservations) {
        if (!occupiesSubagentApplyStatus(record.status)) continue;
        occupyReservation(record);
      }
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

async function runReservedWriter(
  operationStore: SubagentApplyOperationStore,
  input: SubagentResultApplyInput,
  groupId: string | null,
  operationId: string,
  occupy: (resultId: string, groupId: string | null, operationId: string) => void,
  projectApplied: (resultId: string, operationId: string) => void,
): Promise<SubagentResultApplyOutcome> {
  const appliedPromise = input.applyResult({
    resultId: input.resultId,
    expectedRevision: input.expectedRevision,
    operationId,
    ...(input.signal ? { signal: input.signal } : {}),
  });
  try {
    const applied = input.signal
      ? await Promise.race([appliedPromise, waitForApplyAbort(input.signal, operationId)])
      : await appliedPromise;
    if (applied.status === 'rejected') {
      if (input.signal?.aborted) {
        occupy(input.resultId, groupId, operationId);
        return { ok: false, code: 'apply-outcome-unknown', operationId };
      }
      operationStore.releaseSubagentApplyReservation(operationId);
      return { ok: false, code: 'already-applied', alreadyApplied: false };
    }
    if (applied.status === 'workspace-busy') {
      operationStore.releaseSubagentApplyReservation(operationId);
      return { ok: false, code: 'workspace-busy' };
    }
    if (applied.status === 'needs-repair') {
      operationStore.updateOperationStatus(operationId, 'needs-repair');
      occupy(input.resultId, groupId, operationId);
      return { ok: false, code: 'needs-repair' };
    }
    operationStore.updateOperationStatus(operationId, 'succeeded');
    occupy(input.resultId, groupId, operationId);
    projectApplied(input.resultId, operationId);
    return { ok: true, operationId };
  } catch (error) {
    if (isApplyAbortOrTimeoutError(error) || isSubagentApplyOutcomeUnknownError(error)) {
      occupy(input.resultId, groupId, operationId);
      void settleReservedWriterLate(
        appliedPromise,
        operationStore,
        input,
        groupId,
        operationId,
        occupy,
        projectApplied,
      );
      return { ok: false, code: 'apply-outcome-unknown', operationId };
    }
    const current = operationStore.getOperation(operationId);
    if (current?.status === 'succeeded' || operationStore.hasSubagentApplyWriteCompleted(operationId)) {
      if (current?.status !== 'succeeded') {
        operationStore.updateOperationStatus(operationId, 'succeeded');
      }
      occupy(input.resultId, groupId, operationId);
      projectApplied(input.resultId, operationId);
      return { ok: true, operationId };
    }
    if (current?.status === 'needs-repair') {
      occupy(input.resultId, groupId, operationId);
      return { ok: false, code: 'needs-repair' };
    }
    operationStore.releaseSubagentApplyReservation(operationId);
    throw new Error('subagent apply failed before write');
  }
}

function waitForApplyAbort(signal: AbortSignal | undefined, operationId: string): Promise<never> {
  return new Promise((_, reject) => {
    if (!signal) return;
    const fail = () => reject(new SubagentApplyOutcomeUnknownError(operationId));
    if (signal.aborted) {
      fail();
      return;
    }
    signal.addEventListener('abort', fail, { once: true });
  });
}

function settleReservedWriterLate(
  appliedPromise: ReturnType<SubagentResultApplyInput['applyResult']>,
  operationStore: SubagentApplyOperationStore,
  input: SubagentResultApplyInput,
  groupId: string | null,
  operationId: string,
  occupy: (resultId: string, groupId: string | null, operationId: string) => void,
  projectApplied: (resultId: string, operationId: string) => void,
): Promise<void> {
  return appliedPromise.then(
    (applied) => {
      if (applied.status === 'succeeded' || operationStore.hasSubagentApplyWriteCompleted(operationId)) {
        if (operationStore.getOperation(operationId)?.status !== 'succeeded') {
          operationStore.updateOperationStatus(operationId, 'succeeded');
        }
        occupy(input.resultId, groupId, operationId);
        projectApplied(input.resultId, operationId);
        return;
      }
      if (applied.status === 'needs-repair') {
        operationStore.updateOperationStatus(operationId, 'needs-repair');
        occupy(input.resultId, groupId, operationId);
      }
    },
    (error: unknown) => {
      if (isApplyAbortOrTimeoutError(error) || isSubagentApplyOutcomeUnknownError(error)) {
        occupy(input.resultId, groupId, operationId);
        return;
      }
      if (
        operationStore.getOperation(operationId)?.status === 'succeeded' ||
        operationStore.hasSubagentApplyWriteCompleted(operationId)
      ) {
        occupy(input.resultId, groupId, operationId);
        projectApplied(input.resultId, operationId);
      }
    },
  );
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
