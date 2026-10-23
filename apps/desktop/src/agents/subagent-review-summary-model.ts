/**
 * Display helpers for the review/repair loop tree.
 * Phase and lineage come from F1. This module only formats and gates chrome.
 */
import type {
  SubagentLoopControlDisplay,
  SubagentResultSummary,
  SubagentReviewFinding,
  SubagentReviewRecord,
  SubagentReviewSeverity,
  SubagentTaskResult,
} from '@piwin/contracts';
import { SUBAGENT_REVIEW_FINDING_LIMIT } from '@piwin/contracts';
import {
  preferSubagentVerification,
  type SubagentDeliveryLoopPhase,
  type SubagentReviewLoop,
  type SubagentReviewLoopRow,
  type SubagentReviewLoopRowKind,
  type SubagentReviewLoopVerificationFact,
} from './subagent-review-loop-view';

export type DesktopLocaleTag = 'zh-CN' | 'en';

export type SubagentReviewLoopAttach = {
  kind: SubagentReviewLoopRowKind;
  candidateGeneration: number | null;
  superseded?: boolean;
};

export type SubagentReviewActionGate = {
  applyEnabled: boolean;
  resolveEnabled: boolean;
  stale: boolean;
  reason?: string;
  headGeneration: number | null;
  headResultId: string | null;
};

export type SubagentReviewRowCopy = {
  prefix: string;
  title: string;
  status: string;
};

const SEVERITY_RANK: Record<SubagentReviewSeverity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

const STALE_APPLY_REASONS = new Set([
  'candidate-superseded',
  'stale-review',
  'superseded',
  'reviewStale',
]);

export function isSafeRelativeFindingPath(relativePath: string): boolean {
  return (
    relativePath.length > 0 &&
    !relativePath.startsWith('/') &&
    !relativePath.includes('\\') &&
    !relativePath.split('/').includes('..')
  );
}

export function sortReviewFindings(
  findings: readonly SubagentReviewFinding[],
): SubagentReviewFinding[] {
  return [...findings].sort((left, right) => {
    const severityDelta = SEVERITY_RANK[left.severity] - SEVERITY_RANK[right.severity];
    if (severityDelta !== 0) {
      return severityDelta;
    }
    return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
  });
}

export function boundReviewFindings(
  findings: readonly SubagentReviewFinding[],
): SubagentReviewFinding[] {
  return sortReviewFindings(findings).slice(0, SUBAGENT_REVIEW_FINDING_LIMIT);
}

export function reviewLoopRowDepth(index: number): number {
  return index < 0 ? 0 : index;
}

export function formatCandidateVersion(
  generation: number | null | undefined,
  locale: DesktopLocaleTag,
): string {
  const version = generation ?? 1;
  return locale === 'zh-CN' ? `候选 v${String(version)}` : `Candidate v${String(version)}`;
}

export function reviewLoopAttachLabel(
  attach: SubagentReviewLoopAttach,
  locale: DesktopLocaleTag,
): string {
  if (attach.kind === 'review') {
    return locale === 'zh-CN'
      ? `审查：${formatCandidateVersion(attach.candidateGeneration, locale)}`
      : `Review: ${formatCandidateVersion(attach.candidateGeneration, locale)}`;
  }
  return formatCandidateVersion(attach.candidateGeneration, locale);
}

export function verificationFactFromLoopPresentation(
  loop: SubagentLoopControlDisplay | undefined,
): SubagentReviewLoopVerificationFact | undefined {
  if (loop?.kind !== 'verification-submit') {
    return undefined;
  }
  return {
    verificationId: loop.verificationRef.verificationId,
    revision: loop.verificationRef.revision,
    resultId: loop.result.resultId,
    status: loop.status,
  };
}

export function mergeVerificationFacts(
  ...groups: Array<Record<string, SubagentReviewLoopVerificationFact> | undefined>
): Record<string, SubagentReviewLoopVerificationFact> {
  const next: Record<string, SubagentReviewLoopVerificationFact> = {};
  for (const group of groups) {
    if (group === undefined) {
      continue;
    }
    for (const fact of Object.values(group)) {
      next[fact.verificationId] = preferSubagentVerification(next[fact.verificationId], fact);
    }
  }
  return next;
}

export function collectReviewsFromTaskResults(
  taskResults: Record<string, SubagentTaskResult> | undefined,
  explicit?: Record<string, SubagentReviewRecord>,
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

export function reviewForRow(
  row: SubagentReviewLoopRow,
  reviews: Record<string, SubagentReviewRecord> | undefined,
): SubagentReviewRecord | undefined {
  if (reviews === undefined) {
    return undefined;
  }
  if (row.reviewId !== undefined && reviews[row.reviewId] !== undefined) {
    return reviews[row.reviewId];
  }
  if (row.targetResultId === undefined) {
    return undefined;
  }
  return Object.values(reviews).find(
    (record) => record.targetResult.resultId === row.targetResultId,
  );
}

function stalePointer(headGeneration: number | null, locale: DesktopLocaleTag): string {
  const label = formatCandidateVersion(headGeneration, locale);
  return locale === 'zh-CN' ? `请使用${label}` : `Use ${label}`;
}

function availabilityReasonCopy(
  reason: string | undefined,
  locale: DesktopLocaleTag,
): string | undefined {
  if (reason === undefined || reason.length === 0) {
    return undefined;
  }
  if (reason === 'already-applied') {
    return locale === 'zh-CN' ? '已合入' : 'Already applied';
  }
  if (reason === 'legacy-manual') {
    return locale === 'zh-CN' ? '旧版结果需手动处理' : 'Legacy result needs manual handling';
  }
  if (reason === 'not-applicable') {
    return locale === 'zh-CN' ? '当前不可用' : 'Not applicable';
  }
  if (reason === 'result-not-approved') {
    return locale === 'zh-CN' ? '需先批准' : 'Needs an approved review';
  }
  return reason;
}

export function resolveSubagentReviewActionGate(input: {
  loop: SubagentReviewLoop;
  row: SubagentReviewLoopRow;
  result?: SubagentResultSummary;
  locale: DesktopLocaleTag;
}): SubagentReviewActionGate {
  const headGeneration =
    input.loop.rows.find((row) => row.resultId === input.loop.headResultId)?.candidateGeneration ??
    null;
  const stale =
    input.row.superseded === true ||
    input.row.reviewStale === true ||
    (input.result !== undefined &&
      input.result.availability.apply.reason !== undefined &&
      STALE_APPLY_REASONS.has(input.result.availability.apply.reason));
  const applyAllowed = input.result?.availability.apply.allowed === true;
  const resolveAllowed = input.result?.availability.resolve.allowed === true;
  const approvedHead =
    input.result !== undefined &&
    input.result.resultId === input.loop.headResultId &&
    input.result.reviewStatus === 'approved';
  const applyReason =
    input.result?.availability.apply.reason ??
    (!approvedHead && input.result !== undefined ? 'result-not-approved' : undefined);
  const reason = stale
    ? stalePointer(headGeneration, input.locale)
    : availabilityReasonCopy(
        applyReason ?? input.result?.availability.resolve.reason,
        input.locale,
      );
  return {
    applyEnabled: !stale && applyAllowed && approvedHead,
    resolveEnabled: !stale && resolveAllowed,
    stale,
    ...(reason !== undefined ? { reason } : {}),
    headGeneration,
    headResultId: input.loop.headResultId,
  };
}

function producedStatus(generation: number | null, locale: DesktopLocaleTag): string {
  const label = formatCandidateVersion(generation, locale);
  return locale === 'zh-CN' ? `已产出${label}` : `Produced ${label.toLowerCase()}`;
}

function changesRequestedStatus(count: number, locale: DesktopLocaleTag): string {
  return locale === 'zh-CN' ? `需修改 · ${String(count)} 项` : `Changes requested · ${String(count)}`;
}

export function reviewLoopRowCopy(input: {
  row: SubagentReviewLoopRow;
  locale: DesktopLocaleTag;
}): SubagentReviewRowCopy {
  const zh = input.locale === 'zh-CN';
  const versionLabel = formatCandidateVersion(input.row.candidateGeneration, input.locale);
  if (input.row.kind === 'review') {
    const decision = input.row.reviewDecision;
    let status = zh ? '审查中' : 'Reviewing';
    if (decision === 'changes-requested') {
      status = changesRequestedStatus(input.row.findingCount ?? 0, input.locale);
    } else if (decision === 'approved') {
      status = zh ? '已批准' : 'Approved';
    } else if (decision === 'blocked') {
      status = zh ? '已阻塞' : 'Blocked';
    }
    return {
      prefix: zh ? '审查：' : 'Review: ',
      title: versionLabel,
      status,
    };
  }
  const prefix =
    input.row.kind === 'repair' ? (zh ? '返工：' : 'Repair: ') : zh ? '实现：' : 'Implement: ';
  const status =
    input.row.resultId === undefined
      ? input.row.kind === 'repair'
        ? zh
          ? '返工中'
          : 'Repairing'
        : zh
          ? '正在产出'
          : 'Producing'
      : producedStatus(input.row.candidateGeneration, input.locale);
  return {
    prefix,
    title: input.row.title,
    status,
  };
}

export function reviewLoopVerificationCopy(input: {
  loop: SubagentReviewLoop;
  locale: DesktopLocaleTag;
}): { title: string; status: string; incomplete: boolean } {
  const zh = input.locale === 'zh-CN';
  const title = zh ? '集成与验证' : 'Integrate & verify';
  const phase: SubagentDeliveryLoopPhase | null = input.loop.phase;
  if (input.loop.delivered) {
    return { title, status: zh ? '已通过' : 'Passed', incomplete: false };
  }
  if (input.loop.applied && phase === 'blocked') {
    return {
      title,
      status: zh ? '验证失败（未完成）' : 'Verification failed (incomplete)',
      incomplete: true,
    };
  }
  if (input.loop.applied || phase === 'verifying') {
    return { title, status: zh ? '正在验证' : 'Verifying', incomplete: true };
  }
  if (phase === 'applying') {
    return { title, status: zh ? '正在集成' : 'Applying', incomplete: true };
  }
  if (phase === 'approved') {
    return { title, status: zh ? '待集成' : 'Ready to apply', incomplete: true };
  }
  return {
    title,
    status: zh ? '已阻塞' : 'Blocked',
    incomplete: true,
  };
}

export function shouldShowVerificationRow(loop: SubagentReviewLoop): boolean {
  if (loop.legacy) {
    return false;
  }
  if (loop.applied || loop.delivered) {
    return true;
  }
  return (
    loop.phase === 'approved' ||
    loop.phase === 'applying' ||
    loop.phase === 'verifying' ||
    loop.phase === 'delivered' ||
    (loop.phase === 'blocked' && loop.applied)
  );
}

export function shouldPresentReviewLoop(loop: SubagentReviewLoop): boolean {
  return !loop.legacy;
}
