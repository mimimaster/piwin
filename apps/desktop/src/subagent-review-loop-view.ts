/**
 * Pure review-loop projection for async subagent delivery.
 *
 * Reducers store Host records. This module joins them by ids and derives a
 * display-only phase. The phase is never persisted or accepted from a
 * model/client.
 */
import type {
  SubagentDeliveryVerification,
  SubagentInvocation,
  SubagentResultSummary,
  SubagentReviewDecision,
  SubagentReviewRecord,
  SubagentTaskResult,
} from '@piwin/contracts';
import { deriveSubagentResultReviewStatus } from '@piwin/contracts';

export type SubagentDeliveryLoopPhase =
  | 'producing-candidate'
  | 'awaiting-review'
  | 'changes-requested'
  | 'repairing'
  | 'approved'
  | 'applying'
  | 'verifying'
  | 'delivered'
  | 'blocked';

export type SubagentReviewLoopRowKind = 'candidate' | 'review' | 'repair' | 'legacy';

export type SubagentReviewLoopVerificationFact = {
  verificationId: string;
  revision: number;
  resultId: string;
  status: 'passed' | 'failed';
};

export type SubagentReviewLoopRow = {
  id: string;
  kind: SubagentReviewLoopRowKind;
  invocationId?: string;
  runId?: string;
  childSessionId?: string;
  resultId?: string;
  reviewId?: string;
  targetResultId?: string;
  predecessorResultId?: string;
  candidateGeneration: number | null;
  title: string;
  role?: string;
  reviewDecision?: SubagentReviewDecision;
  reviewStale?: boolean;
  findingCount?: number;
  superseded?: boolean;
};

export type SubagentReviewLoop = {
  loopId: string;
  candidateLineageId: string | null;
  headResultId: string | null;
  phase: SubagentDeliveryLoopPhase | null;
  approved: boolean;
  applied: boolean;
  delivered: boolean;
  attention: boolean;
  legacy: boolean;
  rows: SubagentReviewLoopRow[];
};

export type SubagentReviewLoopView = {
  loops: SubagentReviewLoop[];
};

export type DeriveSubagentReviewLoopInput = {
  parentSessionId: string;
  invocations: Record<string, SubagentInvocation>;
  results: Record<string, SubagentResultSummary>;
  reviews?: Record<string, SubagentReviewRecord>;
  verifications?: Record<string, SubagentReviewLoopVerificationFact>;
  taskResults?: Record<string, SubagentTaskResult>;
};

const TERMINAL_REVIEW = new Set<SubagentResultSummary['reviewStatus']>([
  'approved',
  'changes-requested',
  'blocked',
  'stale',
]);

type LoopBucket = {
  results: SubagentResultSummary[];
  invocations: SubagentInvocation[];
};

function isTerminalInvocation(status: SubagentInvocation['status']): boolean {
  return (
    status === 'completed' ||
    status === 'needs-integration' ||
    status === 'failed' ||
    status === 'cancelled'
  );
}

function isExecutionComplete(status: SubagentResultSummary['executionStatus']): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled';
}

function isTerminalReviewStatus(status: SubagentResultSummary['reviewStatus']): boolean {
  return TERMINAL_REVIEW.has(status);
}

export function preferSubagentResult(
  stored: SubagentResultSummary | undefined,
  incoming: SubagentResultSummary,
): SubagentResultSummary {
  if (stored === undefined) {
    return incoming;
  }
  if (incoming.revision < stored.revision) {
    return stored;
  }
  if (incoming.revision === stored.revision) {
    return stored;
  }
  return {
    ...incoming,
    integrationStatus:
      stored.integrationStatus === 'applied' && incoming.integrationStatus !== 'applied'
        ? 'applied'
        : incoming.integrationStatus,
    appliedChanges:
      stored.integrationStatus === 'applied' && incoming.appliedChanges === null
        ? stored.appliedChanges
        : incoming.appliedChanges,
    latestOperationId:
      stored.integrationStatus === 'applied' && incoming.latestOperationId === null
        ? stored.latestOperationId
        : incoming.latestOperationId,
    reviewStatus:
      stored.reviewStatus === 'stale'
        ? 'stale'
        : isTerminalReviewStatus(stored.reviewStatus) &&
            !isTerminalReviewStatus(incoming.reviewStatus)
          ? stored.reviewStatus
          : incoming.reviewStatus,
    latestReview:
      stored.latestReview !== null && incoming.latestReview === null
        ? stored.latestReview
        : incoming.latestReview,
    latestVerification:
      stored.latestVerification !== null && incoming.latestVerification === null
        ? stored.latestVerification
        : incoming.latestVerification,
  };
}

export function mergeSubagentResultRecord(
  stored: Record<string, SubagentResultSummary>,
  candidate: SubagentResultSummary,
): Record<string, SubagentResultSummary> {
  return {
    ...stored,
    [candidate.resultId]: preferSubagentResult(stored[candidate.resultId], candidate),
  };
}

export function preferSubagentVerification(
  stored: SubagentReviewLoopVerificationFact | undefined,
  incoming: SubagentReviewLoopVerificationFact,
): SubagentReviewLoopVerificationFact {
  if (stored === undefined) {
    return incoming;
  }
  if (incoming.revision < stored.revision) {
    return stored;
  }
  if (incoming.revision === stored.revision) {
    return stored;
  }
  return incoming;
}

export function verificationFactFromDelivery(
  record: SubagentDeliveryVerification,
): SubagentReviewLoopVerificationFact {
  return {
    verificationId: record.verificationId,
    revision: record.revision,
    resultId: record.result.resultId,
    status: record.status,
  };
}

function collectReviews(
  explicit: Record<string, SubagentReviewRecord> | undefined,
  taskResults: Record<string, SubagentTaskResult> | undefined,
): Record<string, SubagentReviewRecord> {
  const next: Record<string, SubagentReviewRecord> = { ...explicit };
  if (taskResults === undefined) {
    return next;
  }
  for (const task of Object.values(taskResults)) {
    const review = task.review;
    if (review === undefined) {
      continue;
    }
    const current = next[review.reviewId];
    if (current === undefined || current.revision < review.revision) {
      next[review.reviewId] = review;
    }
  }
  return next;
}

function collectVerifications(
  explicit: Record<string, SubagentReviewLoopVerificationFact> | undefined,
  taskResults: Record<string, SubagentTaskResult> | undefined,
): Record<string, SubagentReviewLoopVerificationFact> {
  const next: Record<string, SubagentReviewLoopVerificationFact> = { ...explicit };
  if (taskResults === undefined) {
    return next;
  }
  for (const task of Object.values(taskResults)) {
    const record = task.deliveryVerification;
    if (record === undefined) {
      continue;
    }
    const fact = verificationFactFromDelivery(record);
    next[fact.verificationId] = preferSubagentVerification(next[fact.verificationId], fact);
  }
  return next;
}

function invocationTitle(invocation: SubagentInvocation): string {
  return invocation.title?.trim() || invocation.task.trim() || 'Subagent task';
}

function resultMatchesInvocation(
  result: SubagentResultSummary,
  invocation: SubagentInvocation,
): boolean {
  if (result.batchRunId === invocation.runId && result.taskId === invocation.taskId) {
    return true;
  }
  if (result.childSessionId !== invocation.childSessionId) {
    return false;
  }
  if (invocation.predecessorResult) {
    return result.predecessorResult?.resultId === invocation.predecessorResult.resultId;
  }
  if (invocation.candidateGeneration !== undefined) {
    return result.candidateGeneration === invocation.candidateGeneration;
  }
  return result.taskId === invocation.taskId || result.predecessorResult === null;
}

function findResultForInvocation(
  invocation: SubagentInvocation,
  results: readonly SubagentResultSummary[],
): SubagentResultSummary | undefined {
  return results.find((result) => resultMatchesInvocation(result, invocation));
}

function reviewerTargetId(invocation: SubagentInvocation): string | undefined {
  return invocation.reviewTarget?.result.resultId;
}

function isReviewerInvocation(invocation: SubagentInvocation): boolean {
  return reviewerTargetId(invocation) !== undefined || invocation.reviewRef !== undefined;
}

function isRepairInvocation(invocation: SubagentInvocation): boolean {
  return invocation.predecessorResult !== undefined;
}

function hasReviewLoopFields(result: SubagentResultSummary): boolean {
  return (
    result.candidateLineageId !== null ||
    result.candidateGeneration !== null ||
    result.predecessorResult !== null ||
    result.latestReview !== null ||
    result.reviewStatus !== 'not-requested'
  );
}

function invocationHasReviewLoopFields(invocation: SubagentInvocation): boolean {
  return (
    invocation.reviewTarget !== undefined ||
    invocation.reviewRef !== undefined ||
    invocation.candidateLineageId !== undefined ||
    invocation.candidateGeneration !== undefined ||
    invocation.predecessorResult !== undefined
  );
}

function isLegacyResult(
  result: SubagentResultSummary,
  linked: readonly SubagentInvocation[],
): boolean {
  if (result.legacyManual) {
    return true;
  }
  if (hasReviewLoopFields(result)) {
    return false;
  }
  return !linked.some((invocation) => invocationHasReviewLoopFields(invocation));
}

function generationOf(result: SubagentResultSummary | undefined): number {
  return result?.candidateGeneration ?? 0;
}

function compareIds(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function rowKindRank(kind: SubagentReviewLoopRowKind): number {
  return kind === 'review' ? 1 : 0;
}

function sortRows(rows: SubagentReviewLoopRow[]): SubagentReviewLoopRow[] {
  return [...rows].sort((left, right) => {
    const generationDelta = (left.candidateGeneration ?? 0) - (right.candidateGeneration ?? 0);
    if (generationDelta !== 0) {
      return generationDelta;
    }
    const kindDelta = rowKindRank(left.kind) - rowKindRank(right.kind);
    if (kindDelta !== 0) {
      return kindDelta;
    }
    return compareIds(left.id, right.id);
  });
}

function sortLoops(loops: SubagentReviewLoop[]): SubagentReviewLoop[] {
  return [...loops].sort((left, right) => compareIds(left.loopId, right.loopId));
}

function reviewForResult(
  result: SubagentResultSummary,
  reviews: Record<string, SubagentReviewRecord>,
  reviewerInvocations: readonly SubagentInvocation[],
): SubagentReviewRecord | undefined {
  if (result.latestReview) {
    const latest = reviews[result.latestReview.reviewId];
    if (latest !== undefined) {
      return latest;
    }
  }
  for (const invocation of reviewerInvocations) {
    if (invocation.reviewRef === undefined) {
      continue;
    }
    const record = reviews[invocation.reviewRef.reviewId];
    if (record !== undefined && record.targetResult.resultId === result.resultId) {
      return record;
    }
  }
  return Object.values(reviews).find((record) => record.targetResult.resultId === result.resultId);
}

function verificationForResult(
  result: SubagentResultSummary,
  verifications: Record<string, SubagentReviewLoopVerificationFact>,
): SubagentReviewLoopVerificationFact | undefined {
  if (result.latestVerification) {
    const byRef = verifications[result.latestVerification.verificationId];
    if (byRef !== undefined) {
      return byRef;
    }
  }
  return Object.values(verifications).find((fact) => fact.resultId === result.resultId);
}

function canonicalGroupKey(result: SubagentResultSummary): string {
  return result.candidateLineageId ?? `child:${result.childSessionId}`;
}

function mergeBucket(target: LoopBucket, source: LoopBucket): void {
  for (const result of source.results) {
    if (!target.results.some((item) => item.resultId === result.resultId)) {
      target.results.push(result);
    }
  }
  for (const invocation of source.invocations) {
    if (!target.invocations.some((item) => item.id === invocation.id)) {
      target.invocations.push(invocation);
    }
  }
}

function resolveGroup(
  key: string,
  remap: Map<string, string>,
): string {
  let current = key;
  const seen = new Set<string>();
  while (remap.has(current) && !seen.has(current)) {
    seen.add(current);
    const next = remap.get(current);
    if (next === undefined) {
      break;
    }
    current = next;
  }
  return current;
}

function addAlias(remap: Map<string, string>, from: string, to: string): void {
  if (from === to) {
    return;
  }
  remap.set(from, to);
}

function buildBuckets(input: {
  invocations: readonly SubagentInvocation[];
  results: readonly SubagentResultSummary[];
}): Map<string, LoopBucket> {
  const remap = new Map<string, string>();
  const resultIdToGroup = new Map<string, string>();
  const childToGroup = new Map<string, string>();
  const buckets = new Map<string, LoopBucket>();

  const bucket = (key: string): LoopBucket => {
    const canonical = resolveGroup(key, remap);
    const existing = buckets.get(canonical);
    if (existing) {
      return existing;
    }
    const created: LoopBucket = { results: [], invocations: [] };
    buckets.set(canonical, created);
    return created;
  };

  for (const result of input.results) {
    const group = canonicalGroupKey(result);
    resultIdToGroup.set(result.resultId, group);
    const previousChild = childToGroup.get(result.childSessionId);
    if (previousChild !== undefined && previousChild !== group) {
      addAlias(remap, previousChild, group);
    }
    childToGroup.set(result.childSessionId, group);
    addAlias(remap, `result:${result.resultId}`, group);
    addAlias(remap, `child:${result.childSessionId}`, group);
    bucket(group).results.push(result);
  }

  for (const invocation of input.invocations) {
    const targetId = reviewerTargetId(invocation);
    const matched = findResultForInvocation(invocation, input.results);
    let group: string | undefined;
    if (targetId !== undefined) {
      group = resultIdToGroup.get(targetId) ?? `result:${targetId}`;
    }
    if (group === undefined && invocation.reviewRef !== undefined) {
      const reviewed = input.results.find(
        (result) => result.latestReview?.reviewId === invocation.reviewRef?.reviewId,
      );
      if (reviewed !== undefined) {
        group = resultIdToGroup.get(reviewed.resultId);
      }
    }
    if (group === undefined && invocation.predecessorResult !== undefined) {
      group =
        resultIdToGroup.get(invocation.predecessorResult.resultId) ??
        `result:${invocation.predecessorResult.resultId}`;
    }
    if (group === undefined && matched !== undefined) {
      group = resultIdToGroup.get(matched.resultId);
    }
    if (group === undefined && invocation.childSessionId !== undefined) {
      group = childToGroup.get(invocation.childSessionId) ?? `child:${invocation.childSessionId}`;
    }
    if (group === undefined) {
      group = invocation.candidateLineageId ?? `inv:${invocation.id}`;
    }
    bucket(group).invocations.push(invocation);
  }

  const merged = new Map<string, LoopBucket>();
  for (const [key, value] of buckets) {
    const canonical = resolveGroup(key, remap);
    const existing = merged.get(canonical);
    if (existing) {
      mergeBucket(existing, value);
    } else {
      merged.set(canonical, value);
    }
  }
  return merged;
}

function candidateRow(input: {
  invocation?: SubagentInvocation;
  result?: SubagentResultSummary;
  kind: 'candidate' | 'repair' | 'legacy';
  superseded: boolean;
}): SubagentReviewLoopRow {
  const generation = input.result?.candidateGeneration ?? input.invocation?.candidateGeneration ?? null;
  const predecessorResultId =
    input.result?.predecessorResult?.resultId ?? input.invocation?.predecessorResult?.resultId;
  const id =
    input.result !== undefined
      ? `${input.kind}:${input.result.resultId}`
      : `invocation:${input.invocation?.id ?? 'unknown'}`;
  const title =
    input.invocation !== undefined
      ? invocationTitle(input.invocation)
      : input.result !== undefined
        ? `Candidate v${String(generation ?? 1)}`
        : 'Subagent task';
  return {
    id,
    kind: input.kind,
    ...(input.invocation !== undefined ? { invocationId: input.invocation.id, runId: input.invocation.runId } : {}),
    ...(input.invocation?.childSessionId !== undefined
      ? { childSessionId: input.invocation.childSessionId }
      : input.result !== undefined
        ? { childSessionId: input.result.childSessionId }
        : {}),
    ...(input.result !== undefined ? { resultId: input.result.resultId } : {}),
    ...(predecessorResultId !== undefined ? { predecessorResultId } : {}),
    candidateGeneration: generation,
    title,
    ...(input.invocation?.role !== undefined ? { role: input.invocation.role } : {}),
    ...(input.superseded ? { superseded: true } : {}),
  };
}

function reviewRow(input: {
  invocation?: SubagentInvocation;
  result: SubagentResultSummary;
  review?: SubagentReviewRecord;
  stale: boolean;
}): SubagentReviewLoopRow {
  const generation = input.result.candidateGeneration;
  const reviewId = input.review?.reviewId ?? input.invocation?.reviewRef?.reviewId;
  const id =
    input.invocation !== undefined
      ? `review-inv:${input.invocation.id}`
      : reviewId !== undefined
        ? `review:${reviewId}`
        : `review-result:${input.result.resultId}`;
  const decision = input.review?.decision;
  return {
    id,
    kind: 'review',
    ...(input.invocation !== undefined
      ? { invocationId: input.invocation.id, runId: input.invocation.runId }
      : {}),
    ...(input.invocation?.childSessionId !== undefined
      ? { childSessionId: input.invocation.childSessionId }
      : {}),
    resultId: input.result.resultId,
    targetResultId: input.result.resultId,
    ...(reviewId !== undefined ? { reviewId } : {}),
    candidateGeneration: generation,
    title: input.invocation !== undefined ? invocationTitle(input.invocation) : 'Review',
    ...(input.invocation?.role !== undefined ? { role: input.invocation.role } : {}),
    ...(decision !== undefined ? { reviewDecision: decision } : {}),
    reviewStale: input.stale,
    ...(input.review !== undefined ? { findingCount: input.review.findings.length } : {}),
    ...(input.stale ? { superseded: true } : {}),
  };
}

function deriveLoopPhase(input: {
  legacy: boolean;
  head?: SubagentResultSummary;
  headInvocation?: SubagentInvocation;
  headReview?: SubagentReviewRecord;
  repairInFlight: boolean;
  verification?: SubagentReviewLoopVerificationFact;
}): SubagentDeliveryLoopPhase | null {
  const head = input.head;
  if (input.verification?.status === 'passed') {
    return 'delivered';
  }
  if (head?.integrationStatus === 'applied') {
    if (input.verification?.status === 'failed') {
      return 'blocked';
    }
    return 'verifying';
  }
  if (head?.integrationStatus === 'pending' || input.headInvocation?.status === 'needs-integration') {
    return 'applying';
  }
  if (head?.integrationStatus === 'conflict' || head?.integrationStatus === 'failed') {
    return 'blocked';
  }
  if (input.legacy) {
    if (head !== undefined && isExecutionComplete(head.executionStatus)) {
      return null;
    }
    return 'producing-candidate';
  }
  const decision = input.headReview?.decision ?? (head?.reviewStatus === 'stale' ? undefined : head?.reviewStatus);
  if (decision === 'blocked' || head?.reviewStatus === 'blocked') {
    return 'blocked';
  }
  if (decision === 'approved' || head?.reviewStatus === 'approved') {
    return 'approved';
  }
  if (decision === 'changes-requested' || head?.reviewStatus === 'changes-requested') {
    return input.repairInFlight ? 'repairing' : 'changes-requested';
  }
  const producing =
    head === undefined ||
    !isExecutionComplete(head.executionStatus) ||
    (input.headInvocation !== undefined && !isTerminalInvocation(input.headInvocation.status));
  if (producing) {
    return 'producing-candidate';
  }
  return 'awaiting-review';
}

function projectBucket(input: {
  loopId: string;
  bucket: LoopBucket;
  reviews: Record<string, SubagentReviewRecord>;
  verifications: Record<string, SubagentReviewLoopVerificationFact>;
}): SubagentReviewLoop {
  const results = [...input.bucket.results].sort((left, right) => {
    const generationDelta = generationOf(left) - generationOf(right);
    if (generationDelta !== 0) {
      return generationDelta;
    }
    return compareIds(left.resultId, right.resultId);
  });
  const invocations = input.bucket.invocations;
  const reviewerInvocations = invocations.filter((invocation) => isReviewerInvocation(invocation));
  const workerInvocations = invocations.filter((invocation) => !isReviewerInvocation(invocation));
  const head = results.length > 0 ? results[results.length - 1] : undefined;
  const headGeneration = head?.candidateGeneration ?? null;
  const linkedForLegacy = invocations;
  const legacy =
    results.length > 0
      ? results.every((result) => isLegacyResult(result, linkedForLegacy))
      : workerInvocations.length > 0 &&
        workerInvocations.every((invocation) => !invocationHasReviewLoopFields(invocation)) &&
        reviewerInvocations.length === 0;

  const rows: SubagentReviewLoopRow[] = [];
  const usedInvocations = new Set<string>();

  const attachReviewers = (result: SubagentResultSummary, stale: boolean): void => {
    const matching = reviewerInvocations.filter((invocation) => {
      const targetId = reviewerTargetId(invocation);
      if (targetId !== undefined) {
        return targetId === result.resultId;
      }
      return invocation.reviewRef?.reviewId === result.latestReview?.reviewId;
    });
    const latestReview = reviewForResult(result, input.reviews, matching);
    if (matching.length === 0 && latestReview === undefined && result.latestReview === null) {
      return;
    }
    if (matching.length === 0) {
      rows.push(reviewRow({
        result,
        stale,
        ...(latestReview !== undefined ? { review: latestReview } : {}),
      }));
      return;
    }
    for (const invocation of matching) {
      usedInvocations.add(invocation.id);
      const review =
        invocation.reviewRef !== undefined
          ? input.reviews[invocation.reviewRef.reviewId] ?? latestReview
          : latestReview;
      rows.push(reviewRow({
        invocation,
        result,
        stale,
        ...(review !== undefined ? { review } : {}),
      }));
    }
  };

  if (legacy) {
    if (results.length === 0) {
      for (const invocation of workerInvocations) {
        usedInvocations.add(invocation.id);
        rows.push(candidateRow({ invocation, kind: 'legacy', superseded: false }));
      }
    } else {
      for (const result of results) {
        const invocation = workerInvocations.find((candidate) => resultMatchesInvocation(result, candidate));
        if (invocation !== undefined) {
          usedInvocations.add(invocation.id);
        }
        rows.push(candidateRow({
          ...(invocation !== undefined ? { invocation } : {}),
          result,
          kind: 'legacy',
          superseded: false,
        }));
      }
    }
  } else {
    for (const result of results) {
      const stale =
        deriveSubagentResultReviewStatus({
          candidateGeneration: result.candidateGeneration,
          lineageHeadGeneration: headGeneration,
          storedStatus: result.reviewStatus,
        }) === 'stale' ||
        (head !== undefined && result.resultId !== head.resultId);
      const invocation = workerInvocations.find((candidate) => resultMatchesInvocation(result, candidate));
      if (invocation !== undefined) {
        usedInvocations.add(invocation.id);
      }
      const kind = result.predecessorResult !== null || invocation?.predecessorResult !== undefined
        ? 'repair'
        : 'candidate';
      rows.push(candidateRow({
        ...(invocation !== undefined ? { invocation } : {}),
        result,
        kind,
        superseded: stale && head !== undefined && result.resultId !== head.resultId,
      }));
      if (!legacy) {
        attachReviewers(result, stale);
      }
    }
    for (const invocation of workerInvocations) {
      if (usedInvocations.has(invocation.id)) {
        continue;
      }
      const matched = findResultForInvocation(invocation, results);
      if (matched !== undefined) {
        continue;
      }
      usedInvocations.add(invocation.id);
      rows.push(candidateRow({
        invocation,
        kind: isRepairInvocation(invocation) ? 'repair' : 'candidate',
        superseded: false,
      }));
    }
    for (const invocation of reviewerInvocations) {
      if (usedInvocations.has(invocation.id)) {
        continue;
      }
      const targetId = reviewerTargetId(invocation);
      const target = targetId !== undefined ? results.find((result) => result.resultId === targetId) : undefined;
      if (target === undefined) {
        usedInvocations.add(invocation.id);
        rows.push({
          id: `review-inv:${invocation.id}`,
          kind: 'review',
          invocationId: invocation.id,
          runId: invocation.runId,
          ...(invocation.childSessionId !== undefined ? { childSessionId: invocation.childSessionId } : {}),
          ...(targetId !== undefined ? { targetResultId: targetId } : {}),
          ...(invocation.reviewRef !== undefined ? { reviewId: invocation.reviewRef.reviewId } : {}),
          candidateGeneration: invocation.candidateGeneration ?? null,
          title: invocationTitle(invocation),
          ...(invocation.role !== undefined ? { role: invocation.role } : {}),
        });
      }
    }
  }

  const headInvocation =
    head !== undefined
      ? workerInvocations.find((invocation) => resultMatchesInvocation(head, invocation))
      : workerInvocations.find((invocation) => !isRepairInvocation(invocation) || !isTerminalInvocation(invocation.status));
  const repairInFlight = workerInvocations.some((invocation) => {
    if (!isRepairInvocation(invocation)) {
      return false;
    }
    if (isTerminalInvocation(invocation.status) && findResultForInvocation(invocation, results) !== undefined) {
      return false;
    }
    return !isTerminalInvocation(invocation.status) || findResultForInvocation(invocation, results) === undefined;
  });
  const headReview =
    head !== undefined ? reviewForResult(head, input.reviews, reviewerInvocations) : undefined;
  const verification =
    head !== undefined ? verificationForResult(head, input.verifications) : undefined;
  const phase = deriveLoopPhase({
    legacy,
    ...(head !== undefined ? { head } : {}),
    ...(headInvocation !== undefined ? { headInvocation } : {}),
    ...(headReview !== undefined ? { headReview } : {}),
    repairInFlight,
    ...(verification !== undefined ? { verification } : {}),
  });
  const approved =
    !legacy &&
    (headReview?.decision === 'approved' || head?.reviewStatus === 'approved');
  const applied = head?.integrationStatus === 'applied';
  const delivered = verification?.status === 'passed';
  const attention =
    verification?.status === 'failed' ||
    head?.integrationStatus === 'conflict' ||
    head?.integrationStatus === 'failed' ||
    headReview?.decision === 'blocked' ||
    head?.reviewStatus === 'blocked';

  return {
    loopId: input.loopId,
    candidateLineageId: head?.candidateLineageId ?? results[0]?.candidateLineageId ?? null,
    headResultId: head?.resultId ?? null,
    phase,
    approved,
    applied,
    delivered,
    attention,
    legacy,
    rows: sortRows(rows),
  };
}

/** Derive one review-loop view from Host-normalized facts. */
export function deriveSubagentReviewLoopView(
  input: DeriveSubagentReviewLoopInput,
): SubagentReviewLoopView {
  const invocations = Object.values(input.invocations).filter(
    (invocation) => invocation.parentSessionId === input.parentSessionId,
  );
  const results = Object.values(input.results).filter(
    (result) => result.parentSessionId === input.parentSessionId,
  );
  const reviews = collectReviews(input.reviews, input.taskResults);
  const verifications = collectVerifications(input.verifications, input.taskResults);
  const buckets = buildBuckets({ invocations, results });
  const loops = [...buckets.entries()].map(([loopId, bucket]) =>
    projectBucket({ loopId, bucket, reviews, verifications }),
  );
  return { loops: sortLoops(loops) };
}
