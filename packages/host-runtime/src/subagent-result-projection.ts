/**
 * Rebuildable subagent result projection. Manifests are the durable record;
 * SubagentResultService is only a cache.
 */
import type {
  SubagentDeliveryIntent,
  SubagentDeliveryVerification,
  SubagentResultAvailability,
  SubagentResultRef,
  SubagentResultSummary,
  SubagentTaskResult,
  SubagentWorkspaceLease,
} from '@piwin/contracts';
import { deriveSubagentResultReviewStatus, emptySubagentResultReviewFields } from '@piwin/contracts';
import type { SubagentPersistedTask, SubagentRunManifest } from '@piwin/session';
import { workspaceIdForRoot } from './turn-changes/coordinator.js';
import type { SubagentResultService } from './subagent-result-service.js';

const LEGACY_UNAVAILABLE = { allowed: false, reason: 'legacy-manual' } as const;
const SUPERSEDED_UNAVAILABLE = { allowed: false, reason: 'candidate-superseded' } as const;

export type SubagentResultProjectionSource = {
  parentSessionId: string;
  result: SubagentTaskResult;
  task?: SubagentPersistedTask | undefined;
  lease?: SubagentWorkspaceLease | undefined;
};

function firstDefined<T>(...values: Array<T | undefined>): T | undefined {
  return values.find((value) => value !== undefined);
}

function matchingDeliveryVerification(
  resultRef: SubagentResultRef | undefined,
  verification: SubagentDeliveryVerification | undefined,
): SubagentDeliveryVerification | undefined {
  if (!resultRef || !verification) return undefined;
  if (
    verification.result.resultId !== resultRef.resultId ||
    verification.result.revision !== resultRef.revision
  ) {
    return undefined;
  }
  return verification;
}

function isLegacyPersistedTask(task: SubagentPersistedTask | undefined, result: SubagentTaskResult): boolean {
  if (result.legacyManual === true || task?.legacyManual === true) return true;
  const hasDelivery = result.deliveryIntent !== undefined || task?.deliveryIntent !== undefined;
  const hasLineage =
    result.candidateLineageId !== undefined ||
    task?.candidateLineageId !== undefined ||
    result.candidateGeneration !== undefined ||
    task?.candidateGeneration !== undefined;
  return !hasDelivery && !hasLineage;
}

function resolveDeliveryIntent(
  task: SubagentPersistedTask | undefined,
  result: SubagentTaskResult,
  lease: SubagentWorkspaceLease | undefined,
  legacy: boolean,
): SubagentDeliveryIntent {
  const admitted = firstDefined(result.deliveryIntent, task?.deliveryIntent);
  if (admitted !== undefined) return admitted;
  if (legacy) {
    return lease?.mode === 'readonly' ? 'report' : 'integrate';
  }
  return lease?.mode === 'readonly' ? 'report' : 'candidate';
}

function resolveTargetWorkspaceId(
  task: SubagentPersistedTask | undefined,
  result: SubagentTaskResult,
  lease: SubagentWorkspaceLease | undefined,
): string {
  const stored = firstDefined(result.targetWorkspaceId, task?.targetWorkspaceId);
  if (stored !== undefined && stored.length > 0) return stored;
  if (lease) return workspaceIdForRoot(lease.parentRepoPath);
  return '';
}

function resolveAvailability(input: {
  legacy: boolean;
  deliveryIntent: SubagentDeliveryIntent;
  applyPolicy: SubagentTaskResult['applyPolicy'] | SubagentPersistedTask['applyPolicy'];
  integrationStatus: SubagentResultSummary['integrationStatus'];
}): SubagentResultAvailability {
  const view = { allowed: true };
  if (input.legacy) {
    return {
      view,
      apply: { ...LEGACY_UNAVAILABLE },
      resolve: { ...LEGACY_UNAVAILABLE },
      cleanup: { ...LEGACY_UNAVAILABLE },
    };
  }
  const finished =
    input.integrationStatus === 'applied' || input.integrationStatus === 'discarded';
  const applyAllowed =
    !finished && input.deliveryIntent !== 'report' && input.applyPolicy !== 'none';
  return {
    view,
    apply: applyAllowed ? { allowed: true } : { allowed: false, reason: finished ? 'already-applied' : 'not-applicable' },
    resolve: { allowed: !finished },
    cleanup: { allowed: true },
  };
}

export function projectSubagentResultSummary(
  source: SubagentResultProjectionSource,
): SubagentResultSummary | undefined {
  const resultRef = source.result.resultRef ?? source.task?.resultRef;
  const childSessionId = source.result.childSessionId;
  if (!resultRef || !childSessionId) return undefined;

  const legacy = isLegacyPersistedTask(source.task, source.result);
  const deliveryIntent = resolveDeliveryIntent(source.task, source.result, source.lease, legacy);
  const lineageId = firstDefined(source.result.candidateLineageId, source.task?.candidateLineageId);
  const generation = firstDefined(source.result.candidateGeneration, source.task?.candidateGeneration);
  const predecessor = firstDefined(source.result.predecessorResult, source.task?.predecessorResult);
  const groupId = firstDefined(source.result.candidateGroupId, source.task?.candidateGroupId);
  const latestReview = firstDefined(source.result.latestReview, source.task?.latestReview);
  const storedReviewStatus = firstDefined(source.result.reviewStatus, source.task?.reviewStatus);
  const verification = matchingDeliveryVerification(
    resultRef,
    source.task?.deliveryVerification,
  );
  const latestVerification = firstDefined(
    source.result.latestVerification,
    verification
      ? { verificationId: verification.verificationId, revision: verification.revision }
      : undefined,
  );
  const appliedChanges = firstDefined(source.result.appliedChanges, verification?.appliedChanges);
  const latestOperationId = firstDefined(
    source.result.latestOperationId,
    verification?.applyOperationId,
  );

  return {
    resultId: resultRef.resultId,
    revision: resultRef.revision,
    parentSessionId: source.parentSessionId,
    childSessionId,
    taskId: source.result.taskId,
    batchRunId: source.result.runId,
    sourceAttemptId: null,
    targetWorkspaceId: resolveTargetWorkspaceId(source.task, source.result, source.lease),
    deliveryIntent,
    legacyManual: legacy,
    candidateGroupId: legacy ? null : (groupId ?? null),
    ...emptySubagentResultReviewFields(),
    ...(legacy
      ? {}
      : {
          candidateLineageId:
            lineageId ?? (deliveryIntent === 'candidate' ? resultRef.resultId : null),
          candidateGeneration: generation ?? (deliveryIntent === 'candidate' ? 1 : null),
          predecessorResult: predecessor ?? null,
          latestReview: latestReview ?? null,
          reviewStatus: storedReviewStatus ?? 'not-requested',
          latestVerification: latestVerification ?? null,
        }),
    executionStatus: source.result.executionStatus,
    summaryStatus: source.result.summaryStatus,
    integrationStatus: source.result.integrationStatus,
    childChanges: source.result.childChanges ?? null,
    appliedChanges: appliedChanges ?? null,
    copyState: 'present',
    latestOperationId: latestOperationId ?? null,
    availability: resolveAvailability({
      legacy,
      deliveryIntent,
      applyPolicy: firstDefined(source.result.applyPolicy, source.task?.applyPolicy),
      integrationStatus: source.result.integrationStatus,
    }),
  };
}

export function enrichSubagentTaskResult(
  result: SubagentTaskResult,
  summary: SubagentResultSummary,
  task?: SubagentPersistedTask,
): SubagentTaskResult {
  const applyPolicy = firstDefined(result.applyPolicy, task?.applyPolicy);
  const groupId = result.candidateGroupId ?? summary.candidateGroupId;
  const lineageId = result.candidateLineageId ?? summary.candidateLineageId;
  const generation = result.candidateGeneration ?? summary.candidateGeneration;
  const predecessor = result.predecessorResult ?? summary.predecessorResult;
  return {
    ...result,
    resultRef: result.resultRef ?? { resultId: summary.resultId, revision: summary.revision },
    ...(result.childChanges || !summary.childChanges
      ? {}
      : { childChanges: summary.childChanges }),
    deliveryIntent: result.deliveryIntent ?? summary.deliveryIntent,
    ...(applyPolicy ? { applyPolicy } : {}),
    legacyManual: result.legacyManual ?? summary.legacyManual,
    ...(groupId ? { candidateGroupId: groupId } : {}),
    ...(summary.targetWorkspaceId ? { targetWorkspaceId: summary.targetWorkspaceId } : {}),
    ...(lineageId ? { candidateLineageId: lineageId } : {}),
    ...(generation !== null && generation !== undefined ? { candidateGeneration: generation } : {}),
    ...(predecessor ? { predecessorResult: predecessor } : {}),
    ...(summary.latestReview ? { latestReview: summary.latestReview } : {}),
    ...(summary.reviewStatus !== 'not-requested' ? { reviewStatus: summary.reviewStatus } : {}),
    ...(summary.latestVerification ? { latestVerification: summary.latestVerification } : {}),
    ...(summary.appliedChanges ? { appliedChanges: summary.appliedChanges } : {}),
    ...(summary.latestOperationId ? { latestOperationId: summary.latestOperationId } : {}),
  };
}

export function hydrateSubagentResultService(
  service: SubagentResultService,
  manifests: readonly SubagentRunManifest[],
): void {
  for (const manifest of manifests) {
    for (const [taskId, result] of Object.entries(manifest.results)) {
      const summary = projectSubagentResultSummary({
        parentSessionId: manifest.parentSessionId,
        result,
        task: manifest.tasks.find((task) => task.id === taskId),
        lease: manifest.leases[taskId],
      });
      if (!summary) continue;
      service.register(summary, result.worktreePath ? { worktreePath: result.worktreePath } : undefined);
    }
  }
  applyPersistedReviewsToResultService(service, manifests);
  applyPersistedVerificationsToResultService(service, manifests);
}

export function applyPersistedReviewsToResultService(
  service: SubagentResultService,
  manifests: readonly SubagentRunManifest[],
): void {
  for (const manifest of manifests) {
    for (const task of manifest.tasks) {
      const review = task.review;
      if (!review) continue;
      const summary = service.get(review.targetResult.resultId);
      if (!summary || summary.revision !== review.targetResult.revision) continue;
      service.register({
        ...summary,
        latestReview: { reviewId: review.reviewId, revision: review.revision },
        reviewStatus: review.decision,
      });
    }
  }
}

export function applyPersistedVerificationsToResultService(
  service: SubagentResultService,
  manifests: readonly SubagentRunManifest[],
): void {
  for (const manifest of manifests) {
    for (const task of manifest.tasks) {
      const verification = task.deliveryVerification;
      if (!verification) continue;
      const summary = service.get(verification.result.resultId);
      if (!summary || summary.revision !== verification.result.revision) continue;
      service.register({
        ...summary,
        latestVerification: {
          verificationId: verification.verificationId,
          revision: verification.revision,
        },
        appliedChanges: verification.appliedChanges,
        latestOperationId: verification.applyOperationId,
      });
    }
  }
}

export function restrictSupersededResultAvailability(
  summary: SubagentResultSummary,
): SubagentResultSummary {
  if (summary.legacyManual) return summary;
  return {
    ...summary,
    availability: {
      ...summary.availability,
      apply: { ...SUPERSEDED_UNAVAILABLE },
      resolve: { ...SUPERSEDED_UNAVAILABLE },
    },
  };
}

export function projectLineageHeadGeneration(
  members: readonly SubagentResultSummary[],
): number | null {
  const generations = members
    .map((member) => member.candidateGeneration)
    .filter((generation): generation is number => generation !== null);
  if (generations.length === 0) return null;
  return Math.max(...generations);
}

export function applyLineageHeadProjection(summaries: readonly SubagentResultSummary[]): SubagentResultSummary[] {
  const byLineage = new Map<string, SubagentResultSummary[]>();
  for (const summary of summaries) {
    if (!summary.candidateLineageId) continue;
    const members = byLineage.get(summary.candidateLineageId) ?? [];
    members.push(summary);
    byLineage.set(summary.candidateLineageId, members);
  }

  const superseded = new Map<string, SubagentResultSummary>();
  for (const members of byLineage.values()) {
    const headGeneration = projectLineageHeadGeneration(members);
    for (const member of members) {
      const reviewStatus = deriveSubagentResultReviewStatus({
        candidateGeneration: member.candidateGeneration,
        lineageHeadGeneration: headGeneration,
        storedStatus: member.reviewStatus === 'stale' ? 'not-requested' : member.reviewStatus,
      });
      const next =
        reviewStatus === 'stale'
          ? restrictSupersededResultAvailability({ ...member, reviewStatus })
          : { ...member, reviewStatus };
      superseded.set(next.resultId, next);
    }
  }

  return summaries.map((summary) => superseded.get(summary.resultId) ?? summary);
}
