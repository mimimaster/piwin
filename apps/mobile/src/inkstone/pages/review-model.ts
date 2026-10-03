import type { HostPush, HostResponse, SubagentResultActionAvailability } from '@piwin/contracts';
import { isRecord } from '../../mobile-host-helpers.js';

export const RESULT_PAGE_SIZE = 20;
export const FILE_PAGE_SIZE = 32;
export const PATCH_DISPLAY_LIMIT = 64 * 1024;
export type ReviewResult = {
  resultId: string;
  revision: number;
  parentSessionId: string;
  batchRunId?: string;
  executionStatus?: string;
  summaryStatus?: string;
  integrationStatus?: string;
  reviewStatus?: string;
  latestReview?: { reviewId: string; revision: number };
  latestVerification?: { verificationId: string; revision: number };
  availability: Partial<Record<'view' | 'apply' | 'resolve' | 'cleanup', SubagentResultActionAvailability>>;
};
export type ReviewFile = { fileId: string; relativePath: string; kind: 'added' | 'modified' | 'deleted' };
export type ReviewDiff = {
  additions: number | null;
  deletions: number | null;
  binary: boolean | undefined;
  patch?: string;
  locallyClipped: boolean;
};
export type ReviewPageData<T> = { items: T[]; nextCursor?: string };
export type VerificationStatus = 'passed' | 'failed';

function identifier(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 1024;
}
function positiveRevision(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}
function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.length <= 4096 ? value : undefined;
}
function ref<K extends 'reviewId' | 'verificationId'>(value: unknown, key: K): (Record<K, string> & { revision: number }) | undefined {
  if (!isRecord(value) || !identifier(value[key]) || !positiveRevision(value.revision)) return undefined;
  // Known keys only: never retain a receipt, scope or evidence payload.
  return { [key]: value[key], revision: value.revision } as Record<K, string> & { revision: number };
}
export function resultKey(result: ReviewResult): string {
  return JSON.stringify([result.resultId, result.revision]);
}
export function readResult(value: unknown, parentSessionId: string): ReviewResult | undefined {
  if (!isRecord(value) || !identifier(value.resultId) || !positiveRevision(value.revision) ||
      value.parentSessionId !== parentSessionId) return undefined;
  const result: ReviewResult = { resultId: value.resultId, revision: value.revision, parentSessionId, availability: {} };
  if (identifier(value.batchRunId)) result.batchRunId = value.batchRunId;
  const statuses = {
    executionStatus: ['queued', 'running', 'completed', 'failed', 'cancelled'],
    summaryStatus: ['not-requested', 'pending', 'merged', 'failed'],
    integrationStatus: ['not-requested', 'pending', 'applied', 'conflict', 'failed', 'retained', 'discarded'],
    reviewStatus: ['not-requested', 'pending', 'approved', 'changes-requested', 'blocked', 'stale'],
  };
  for (const key of ['executionStatus', 'summaryStatus', 'integrationStatus', 'reviewStatus'] as const) {
    const status = text(value[key]);
    if (status !== undefined && statuses[key].includes(status)) result[key] = status;
  }
  const review = ref(value.latestReview, 'reviewId');
  const verification = ref(value.latestVerification, 'verificationId');
  if (review !== undefined) result.latestReview = review;
  if (verification !== undefined) result.latestVerification = verification;
  if (isRecord(value.availability)) {
    for (const key of ['view', 'apply', 'resolve', 'cleanup'] as const) {
      const action = value.availability[key];
      if (!isRecord(action) || typeof action.allowed !== 'boolean') continue;
      const projected: SubagentResultActionAvailability = { allowed: action.allowed };
      const reason = text(action.reason);
      if (reason !== undefined) projected.reason = reason;
      result.availability[key] = projected;
    }
  }
  return result;
}
function data(response: HostResponse): Record<string, unknown> {
  if (!response.success) throw new Error(response.error);
  if (!isRecord(response.data)) throw new Error('Host 返回了无法识别的审阅数据。');
  return response.data;
}
function page<T>(response: HostResponse, key: 'items' | 'files', limit: number, reader: (value: unknown) => T | undefined): ReviewPageData<T> {
  const body = data(response);
  const raw = body[key];
  if (!Array.isArray(raw) || raw.length > limit) throw new Error('Host 列表格式或页大小不符合公开读取约定。');
  const items: T[] = [];
  for (const value of raw) {
    const item = reader(value);
    if (item === undefined) throw new Error('Host 列表包含无法确认引用的条目。');
    items.push(item);
  }
  if (body.nextCursor !== undefined && !identifier(body.nextCursor)) throw new Error('Host 返回了无效分页游标。');
  return { items, ...(identifier(body.nextCursor) ? { nextCursor: body.nextCursor } : {}) };
}
export function readResults(response: HostResponse, parentSessionId: string): ReviewPageData<ReviewResult> {
  return page(response, 'items', RESULT_PAGE_SIZE, (value) => readResult(value, parentSessionId));
}
export function readFiles(response: HostResponse): ReviewPageData<ReviewFile> {
  return page(response, 'files', FILE_PAGE_SIZE, (value) => {
    if (!isRecord(value) || !identifier(value.fileId) || typeof value.relativePath !== 'string' ||
        value.relativePath.length === 0 || value.relativePath.length > 4096 ||
        (value.kind !== 'added' && value.kind !== 'modified' && value.kind !== 'deleted')) return undefined;
    return { fileId: value.fileId, relativePath: value.relativePath, kind: value.kind };
  });
}
export function readDiff(response: HostResponse): ReviewDiff {
  const body = data(response);
  const count = (value: unknown): number | null => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
  const patch = typeof body.patch === 'string' ? body.patch : undefined;
  return {
    additions: count(body.additions), deletions: count(body.deletions),
    binary: typeof body.binary === 'boolean' ? body.binary : undefined,
    ...(patch !== undefined ? { patch: patch.slice(0, PATCH_DISPLAY_LIMIT) } : {}),
    locallyClipped: patch !== undefined && patch.length > PATCH_DISPLAY_LIMIT,
  };
}
/** Extract only an exact result + verification revision and status, never the batch itself. */
export function readVerification(response: HostResponse, result: ReviewResult): VerificationStatus | undefined {
  const body = data(response);
  if (body.runId !== result.batchRunId || !Array.isArray(body.results) || result.latestVerification === undefined) return undefined;
  const statuses = new Set<VerificationStatus>();
  for (const task of body.results) {
    if (!isRecord(task) || task.runId !== result.batchRunId || !isRecord(task.resultRef) || task.resultRef.resultId !== result.resultId ||
        task.resultRef.revision !== result.revision || !isRecord(task.deliveryVerification)) continue;
    const receipt = task.deliveryVerification;
    if (!isRecord(receipt.result) || receipt.parentSessionId !== result.parentSessionId ||
        receipt.result.resultId !== result.resultId || receipt.result.revision !== result.revision ||
        receipt.verificationId !== result.latestVerification.verificationId ||
        receipt.revision !== result.latestVerification.revision) continue;
    if (receipt.status === 'passed' || receipt.status === 'failed') statuses.add(receipt.status);
  }
  return statuses.size === 1 ? [...statuses][0] : undefined;
}
export function relevantReviewPush(push: HostPush, sessionId: string): boolean {
  switch (push.type) {
    case 'subagent/result-updated':
    case 'subagent/invocation-updated':
    case 'subagent/merged':
    case 'subagent/batch-updated':
    case 'subagent/task-updated':
      return push.parentSessionId === sessionId;
    default: return false;
  }
}
export function advanceCursor(cursor: string | undefined, seen: Set<string>): string | undefined {
  if (cursor === undefined) return undefined;
  if (seen.has(cursor)) throw new Error('Host 重复返回分页游标；已停止继续读取，请刷新。');
  seen.add(cursor);
  return cursor;
}
export function verificationLabel(result: ReviewResult, status: VerificationStatus | undefined): string {
  if (status === 'failed' && result.integrationStatus === 'applied') return '已应用但验收失败，不代表已交付';
  if (status === 'failed') return 'Host 验收失败，不代表已交付';
  if (status === 'passed') return 'Host 精确引用验收通过（不推断交付状态）';
  return '验收状态未公开/无法确认';
}
