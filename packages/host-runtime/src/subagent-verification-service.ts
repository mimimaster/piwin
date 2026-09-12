/**
 * Durable post-apply delivery verification. Manifests are the source of truth;
 * the result service is only a projection cache.
 */
import { randomUUID } from 'node:crypto';
import type {
  HostPush,
  SubagentDeliveryVerification,
  SubagentResultRef,
  SubagentResultSummary,
  SubagentReviewRef,
  SubagentVerificationRef,
  ToolResult,
} from '@piwin/contracts';
import {
  validateSubagentDeliveryVerificationBounds,
  validateSubagentDeliveryVerificationStatus,
} from '@piwin/contracts';
import type { SubagentRunStore } from '@piwin/session';
import { isExactReviewTarget } from './subagent-review-context.js';
import { findPersistedReview, reviewAuthorizesApply } from './subagent-review-service.js';
import type { SubagentResultService } from './subagent-result-service.js';

export type SubagentVerificationSubmitInput = {
  parentSessionId: string;
  parentRunId: string;
  result: SubagentResultRef;
  approvedBy: SubagentReviewRef;
  applyOperationId: string;
  status: SubagentDeliveryVerification['status'];
  checks: SubagentDeliveryVerification['checks'];
};

export type SubagentVerificationSubmitResult =
  | { ok: true; record: SubagentDeliveryVerification; duplicate: boolean }
  | Extract<ToolResult, { ok: false }>;

export type SubagentVerificationService = {
  submit(input: SubagentVerificationSubmitInput): Promise<SubagentVerificationSubmitResult>;
};

export type SubagentVerificationServiceOptions = {
  runStore: SubagentRunStore;
  resultService: SubagentResultService;
  publish?: (message: HostPush) => void;
  now?: () => Date;
  createId?: () => string;
};

function verificationError(
  code: Extract<ToolResult, { ok: false }>['code'],
  message: string,
): Extract<ToolResult, { ok: false }> {
  return { ok: false, code, message };
}

function isExactReviewRef(left: SubagentReviewRef, right: SubagentReviewRef): boolean {
  return left.reviewId === right.reviewId && left.revision === right.revision;
}

export function verificationRefFromRecord(
  record: SubagentDeliveryVerification,
): SubagentVerificationRef {
  return { verificationId: record.verificationId, revision: record.revision };
}

export function createSubagentVerificationService(
  options: SubagentVerificationServiceOptions,
): SubagentVerificationService {
  const now = options.now ?? (() => new Date());
  const createId = options.createId ?? (() => randomUUID());

  return {
    async submit(input) {
      const summary = options.resultService.get(input.result.resultId);
      if (!summary) {
        return verificationError('review-target-not-found', 'result was not found');
      }
      if (
        input.parentSessionId !== summary.parentSessionId ||
        input.parentSessionId === summary.childSessionId
      ) {
        return verificationError(
          'review-target-forbidden',
          'verification must be submitted by the result parent session',
        );
      }
      if (summary.revision !== input.result.revision) {
        return verificationError('stale-revision', 'result revision is stale');
      }
      if (summary.integrationStatus !== 'applied') {
        return verificationError('invalid-input', 'result is not successfully applied');
      }
      if (!summary.appliedChanges) {
        return verificationError('review-data-expired', 'applied changes are unavailable');
      }
      if (summary.latestOperationId !== input.applyOperationId) {
        return verificationError(
          'invalid-input',
          'applyOperationId does not match the applied result',
        );
      }
      if (!summary.latestReview) {
        return verificationError('review-missing', 'structured review is missing');
      }
      if (!isExactReviewRef(input.approvedBy, summary.latestReview)) {
        return verificationError('stale-review', 'approvedBy is not the durable latest review');
      }
      if (!reviewAuthorizesApply(summary)) {
        return verificationError('result-not-approved', 'result is not authorized by an approved review');
      }
      const review = await findPersistedReview(options.runStore, input.approvedBy);
      if (!review) {
        return verificationError('review-missing', 'structured review was not found');
      }
      if (review.decision !== 'approved' || !reviewAuthorizesApply({
        latestReview: { reviewId: review.reviewId, revision: review.revision },
        reviewStatus: review.decision,
      })) {
        return verificationError('result-not-approved', 'result is not authorized by an approved review');
      }
      if (!isExactReviewTarget(review.targetResult, input.result)) {
        return verificationError('stale-review', 'review does not authorize this result');
      }

      const statusCheck = validateSubagentDeliveryVerificationStatus({
        status: input.status,
        checks: input.checks,
      });
      if (!statusCheck.ok) {
        return verificationError(
          'invalid-input',
          statusCheck.issues[0]?.message ?? 'invalid verification status',
        );
      }
      const bounds = validateSubagentDeliveryVerificationBounds({ checks: input.checks });
      if (!bounds.ok) {
        return verificationError('invalid-input', bounds.issues[0]?.message ?? 'verification exceeds bounds');
      }

      const record: SubagentDeliveryVerification = {
        verificationId: createId(),
        revision: 1,
        parentSessionId: summary.parentSessionId,
        parentRunId: input.parentRunId,
        result: { resultId: summary.resultId, revision: summary.revision },
        approvedBy: { ...input.approvedBy },
        applyOperationId: input.applyOperationId,
        appliedChanges: { ...summary.appliedChanges },
        status: input.status,
        checks: input.checks,
        createdAt: now().toISOString(),
      };

      const persisted = await options.runStore.persistDeliveryVerification(
        summary.batchRunId,
        summary.taskId,
        record,
      );
      if (!persisted.ok) {
        return persisted.code === 'conflict'
          ? verificationError('invalid-input', 'this result already has a different verification')
          : verificationError('review-target-not-found', 'worker result was not found');
      }

      const duplicate =
        persisted.record.verificationId !== record.verificationId ||
        persisted.record.createdAt !== record.createdAt;
      const stored = persisted.record;
      const verificationRef = verificationRefFromRecord(stored);
      const nextSummary: SubagentResultSummary = {
        ...summary,
        latestVerification: verificationRef,
        appliedChanges: stored.appliedChanges,
        latestOperationId: stored.applyOperationId,
      };
      options.resultService.register(nextSummary);
      await options.runStore.projectResultVerification(
        summary.batchRunId,
        summary.taskId,
        verificationRef,
      );

      options.publish?.({
        type: 'subagent/result-updated',
        parentSessionId: summary.parentSessionId,
        result: options.resultService.get(summary.resultId) ?? nextSummary,
      });

      return { ok: true, record: stored, duplicate };
    },
  };
}
