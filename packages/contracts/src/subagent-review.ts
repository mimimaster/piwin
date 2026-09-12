/** Structured review and delivery-verification records for subagent results. */

import type { ChangeVersionRef, SubagentResultRef } from './subagent-delivery.js';

export const SUBAGENT_REVIEW_FINDING_LIMIT = 50;
export const SUBAGENT_REVIEW_TITLE_MAX_CHARS = 160;
export const SUBAGENT_REVIEW_DETAIL_MAX_CHARS = 2000;
export const SUBAGENT_REVIEW_EVIDENCE_MAX_CHARS = 2000;
export const SUBAGENT_REVIEW_VERIFICATION_LIMIT = 20;
export const SUBAGENT_DELIVERY_VERIFICATION_CHECK_LIMIT = 20;
export const SUBAGENT_DELIVERY_VERIFICATION_EVIDENCE_MAX_CHARS = 2000;

export type SubagentReviewDecision = 'approved' | 'changes-requested' | 'blocked';

export type SubagentReviewSeverity = 'critical' | 'high' | 'medium' | 'low';

export type SubagentReviewFinding = {
  id: string;
  severity: SubagentReviewSeverity;
  title: string;
  detail: string;
  relativePath?: string;
  line?: number;
  evidence?: string;
};

export type SubagentReviewRef = {
  reviewId: string;
  revision: number;
};

export type SubagentReviewRecord = {
  reviewId: string;
  revision: number;
  parentSessionId: string;
  reviewerSessionId: string;
  reviewerRunId: string;
  targetResult: SubagentResultRef;
  targetChanges: ChangeVersionRef;
  decision: SubagentReviewDecision;
  findings: SubagentReviewFinding[];
  verification: Array<{
    label: string;
    status: 'passed' | 'failed' | 'not-run';
    evidence?: string;
  }>;
  createdAt: string;
};

export type SubagentVerificationRef = {
  verificationId: string;
  revision: number;
};

export type SubagentDeliveryVerification = {
  verificationId: string;
  revision: number;
  parentSessionId: string;
  parentRunId: string;
  result: SubagentResultRef;
  approvedBy: SubagentReviewRef;
  applyOperationId: string;
  appliedChanges: ChangeVersionRef;
  status: 'passed' | 'failed';
  checks: Array<{
    label: string;
    status: 'passed' | 'failed';
    evidence: string;
  }>;
  createdAt: string;
};

export type SubagentReviewTarget = {
  result: SubagentResultRef;
  changes: ChangeVersionRef;
};

export type SubagentLineageRefs = {
  reviewTarget?: SubagentReviewTarget;
  reviewRef?: SubagentReviewRef;
  candidateLineageId?: string;
  candidateGeneration?: number;
  predecessorResult?: SubagentResultRef;
};

export type SubagentReviewBoundsIssue = {
  code: string;
  message: string;
  field?: string;
};

export type SubagentReviewBoundsResult =
  | { ok: true }
  | { ok: false; issues: SubagentReviewBoundsIssue[] };

function isSafeRelativePath(relativePath: string): boolean {
  return (
    relativePath.length > 0 &&
    !relativePath.startsWith('/') &&
    !relativePath.includes('\\') &&
    !relativePath.split('/').includes('..')
  );
}

function addIssue(
  issues: SubagentReviewBoundsIssue[],
  code: string,
  message: string,
  field?: string,
): void {
  issues.push(field === undefined ? { code, message } : { code, message, field });
}

function validateFinding(
  finding: SubagentReviewFinding,
  index: number,
  frozenRelativePaths: readonly string[] | undefined,
  issues: SubagentReviewBoundsIssue[],
): void {
  const prefix = `findings[${String(index)}]`;
  if (finding.title.length > SUBAGENT_REVIEW_TITLE_MAX_CHARS) {
    addIssue(issues, 'title-too-long', `title exceeds ${String(SUBAGENT_REVIEW_TITLE_MAX_CHARS)} characters`, `${prefix}.title`);
  }
  if (finding.detail.length > SUBAGENT_REVIEW_DETAIL_MAX_CHARS) {
    addIssue(issues, 'detail-too-long', `detail exceeds ${String(SUBAGENT_REVIEW_DETAIL_MAX_CHARS)} characters`, `${prefix}.detail`);
  }
  if (
    finding.evidence !== undefined &&
    finding.evidence.length > SUBAGENT_REVIEW_EVIDENCE_MAX_CHARS
  ) {
    addIssue(
      issues,
      'evidence-too-long',
      `evidence exceeds ${String(SUBAGENT_REVIEW_EVIDENCE_MAX_CHARS)} characters`,
      `${prefix}.evidence`,
    );
  }
  if (finding.relativePath !== undefined) {
    if (!isSafeRelativePath(finding.relativePath)) {
      addIssue(issues, 'unsafe-path', 'relativePath must be a safe relative path', `${prefix}.relativePath`);
    } else if (
      frozenRelativePaths !== undefined &&
      !frozenRelativePaths.includes(finding.relativePath)
    ) {
      addIssue(
        issues,
        'unknown-path',
        'relativePath must match the frozen result file list',
        `${prefix}.relativePath`,
      );
    }
  }
  if (finding.line !== undefined && (!Number.isInteger(finding.line) || finding.line < 1)) {
    addIssue(issues, 'invalid-line', 'line must be a positive integer', `${prefix}.line`);
  }
}

export function pickSubagentLineageRefs(source: SubagentLineageRefs): SubagentLineageRefs {
  return {
    ...(source.reviewTarget
      ? {
          reviewTarget: {
            result: { ...source.reviewTarget.result },
            changes: { ...source.reviewTarget.changes },
          },
        }
      : {}),
    ...(source.reviewRef ? { reviewRef: { ...source.reviewRef } } : {}),
    ...(source.candidateLineageId ? { candidateLineageId: source.candidateLineageId } : {}),
    ...(source.candidateGeneration !== undefined
      ? { candidateGeneration: source.candidateGeneration }
      : {}),
    ...(source.predecessorResult ? { predecessorResult: { ...source.predecessorResult } } : {}),
  };
}

export function validateSubagentReviewBounds(input: {
  findings: SubagentReviewFinding[];
  verification: SubagentReviewRecord['verification'];
  frozenRelativePaths?: readonly string[];
}): SubagentReviewBoundsResult {
  const issues: SubagentReviewBoundsIssue[] = [];
  if (input.findings.length > SUBAGENT_REVIEW_FINDING_LIMIT) {
    addIssue(
      issues,
      'findings-limit',
      `findings exceed the maximum of ${String(SUBAGENT_REVIEW_FINDING_LIMIT)}`,
    );
  }
  if (input.verification.length > SUBAGENT_REVIEW_VERIFICATION_LIMIT) {
    addIssue(
      issues,
      'verification-limit',
      `verification entries exceed the maximum of ${String(SUBAGENT_REVIEW_VERIFICATION_LIMIT)}`,
    );
  }
  for (const [index, finding] of input.findings.entries()) {
    validateFinding(finding, index, input.frozenRelativePaths, issues);
  }
  for (const [index, entry] of input.verification.entries()) {
    if (
      entry.evidence !== undefined &&
      entry.evidence.length > SUBAGENT_REVIEW_EVIDENCE_MAX_CHARS
    ) {
      addIssue(
        issues,
        'evidence-too-long',
        `evidence exceeds ${String(SUBAGENT_REVIEW_EVIDENCE_MAX_CHARS)} characters`,
        `verification[${String(index)}].evidence`,
      );
    }
  }
  return issues.length === 0 ? { ok: true } : { ok: false, issues };
}

export function validateSubagentDeliveryVerificationBounds(input: {
  checks: SubagentDeliveryVerification['checks'];
}): SubagentReviewBoundsResult {
  const issues: SubagentReviewBoundsIssue[] = [];
  if (input.checks.length > SUBAGENT_DELIVERY_VERIFICATION_CHECK_LIMIT) {
    addIssue(
      issues,
      'checks-limit',
      `checks exceed the maximum of ${String(SUBAGENT_DELIVERY_VERIFICATION_CHECK_LIMIT)}`,
    );
  }
  for (const [index, check] of input.checks.entries()) {
    if (check.evidence.length > SUBAGENT_DELIVERY_VERIFICATION_EVIDENCE_MAX_CHARS) {
      addIssue(
        issues,
        'evidence-too-long',
        `evidence exceeds ${String(SUBAGENT_DELIVERY_VERIFICATION_EVIDENCE_MAX_CHARS)} characters`,
        `checks[${String(index)}].evidence`,
      );
    }
  }
  return issues.length === 0 ? { ok: true } : { ok: false, issues };
}
