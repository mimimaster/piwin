/**
 * Host-normalized async subagent control-tool presentation.
 *
 * Desktop renders these shapes only — never raw child transcripts or Pi-native
 * tool details. IDs are opaque links; display strings are bounded at the Host
 * boundary before they reach clients.
 */

import type { SubagentResultRef } from './subagent-delivery.js';
import type {
  SubagentExecutionStatus,
  SubagentIntegrationStatus,
  SubagentSummaryStatus,
} from './subagent-lifecycle.js';
import type {
  SubagentReviewDecision,
  SubagentReviewRef,
  SubagentVerificationRef,
} from './subagent-review.js';

/** Max chars for a run row title shown in control-tool cards. */
export const SUBAGENT_CONTROL_TITLE_MAX_CHARS = 96;

/** Max chars for a short activity line (phase / progress hint). */
export const SUBAGENT_CONTROL_ACTIVITY_MAX_CHARS = 120;

/** Max chars for a merged-summary preview snippet on a run row. */
export const SUBAGENT_CONTROL_SUMMARY_PREVIEW_MAX_CHARS = 240;

/** Max chars for the accepted-phase task blurb on start/run tools. */
export const SUBAGENT_CONTROL_TASK_MAX_CHARS = 500;

/**
 * Max run rows attached to wait/cancel control presentation.
 * Must stay aligned with {@link MAX_SUBAGENT_TASKS_PER_BATCH} in subagent-orchestration.
 */
export const SUBAGENT_CONTROL_MAX_RUNS = 8 as const;

export type SubagentResultReadMode = 'summary' | 'files' | 'diff';

/** One bounded run row for wait/cancel aggregate presentation. */
export type SubagentControlRunDisplay = {
  runId: string;
  invocationId?: string;
  childSessionId?: string;
  title?: string;
  activity?: string;
  summaryPreview?: string;
  executionStatus: SubagentExecutionStatus;
  summaryStatus?: SubagentSummaryStatus;
  integrationStatus?: SubagentIntegrationStatus;
};

export type SubagentControlDisplay =
  | {
      phase: 'accepted';
      runId: string;
      invocationId: string;
      task: string;
      childSessionId?: string;
      predecessorResult?: SubagentResultRef;
      reviewRef?: SubagentReviewRef;
    }
  | {
      phase: 'waiting' | 'waited';
      total: number;
      completed: number;
      failed: number;
      cancelled: number;
      needsIntegration: number;
      runs: SubagentControlRunDisplay[];
    }
  | {
      phase: 'cancelling' | 'cancelled';
      total: number;
      cancelled: number;
      alreadyTerminal: number;
      runs: SubagentControlRunDisplay[];
    };

/**
 * Review-loop control tools. Sibling of {@link SubagentControlDisplay} so
 * Desktop invocation/wait rows can keep ignoring unknown presentation fields.
 * Never use `kind: 'subagent'` for these.
 */
export type SubagentLoopControlDisplay =
  | {
      kind: 'result-read';
      result: SubagentResultRef;
      mode: SubagentResultReadMode;
      summary: string;
    }
  | {
      kind: 'review-submit';
      reviewRef: SubagentReviewRef;
      decision: SubagentReviewDecision;
      target: SubagentResultRef;
    }
  | {
      kind: 'result-apply';
      result: SubagentResultRef;
      operationId: string;
      integrationStatus: SubagentIntegrationStatus;
    }
  | {
      kind: 'verification-submit';
      result: SubagentResultRef;
      verificationRef: SubagentVerificationRef;
      status: 'passed' | 'failed';
    };

const EXECUTION_STATUSES = new Set<string>([
  'queued',
  'running',
  'completed',
  'failed',
  'cancelled',
]);

const SUMMARY_STATUSES = new Set<string>([
  'not-requested',
  'pending',
  'merged',
  'failed',
]);

const INTEGRATION_STATUSES = new Set<string>([
  'not-requested',
  'pending',
  'applied',
  'conflict',
  'failed',
  'retained',
  'discarded',
]);

const RESULT_READ_MODES = new Set<string>(['summary', 'files', 'diff']);
const REVIEW_DECISIONS = new Set<string>(['approved', 'changes-requested', 'blocked']);
const VERIFICATION_STATUSES = new Set<string>(['passed', 'failed']);

function clipBoundedText(raw: string, maxChars: number): string {
  const trimmed = raw.trim();
  if (trimmed.length <= maxChars) return trimmed;
  if (maxChars <= 1) return '…';
  return `${trimmed.slice(0, maxChars - 1).trimEnd()}…`;
}

export function boundSubagentControlText(raw: string, maxChars: number): string {
  if (!raw.trim()) return '';
  return clipBoundedText(raw.replace(/\s+/g, ' '), maxChars);
}

export function boundSubagentControlRunDisplay(
  input: SubagentControlRunDisplay,
): SubagentControlRunDisplay {
  const row: SubagentControlRunDisplay = {
    runId: input.runId,
    executionStatus: input.executionStatus,
  };
  if (input.invocationId) row.invocationId = input.invocationId;
  if (input.childSessionId) row.childSessionId = input.childSessionId;
  if (input.title) {
    row.title = boundSubagentControlText(input.title, SUBAGENT_CONTROL_TITLE_MAX_CHARS);
  }
  if (input.activity) {
    row.activity = boundSubagentControlText(input.activity, SUBAGENT_CONTROL_ACTIVITY_MAX_CHARS);
  }
  if (input.summaryPreview) {
    row.summaryPreview = boundSubagentControlText(
      input.summaryPreview,
      SUBAGENT_CONTROL_SUMMARY_PREVIEW_MAX_CHARS,
    );
  }
  if (input.summaryStatus) row.summaryStatus = input.summaryStatus;
  if (input.integrationStatus) row.integrationStatus = input.integrationStatus;
  return row;
}

function copyResultRef(ref: SubagentResultRef): SubagentResultRef {
  return { resultId: ref.resultId, revision: ref.revision };
}

function copyReviewRef(ref: SubagentReviewRef): SubagentReviewRef {
  return { reviewId: ref.reviewId, revision: ref.revision };
}

function copyVerificationRef(ref: SubagentVerificationRef): SubagentVerificationRef {
  return { verificationId: ref.verificationId, revision: ref.revision };
}

function boundAcceptedDisplay(
  input: Extract<SubagentControlDisplay, { phase: 'accepted' }>,
): Extract<SubagentControlDisplay, { phase: 'accepted' }> {
  const next: Extract<SubagentControlDisplay, { phase: 'accepted' }> = {
    phase: 'accepted',
    runId: input.runId,
    invocationId: input.invocationId,
    task: boundSubagentControlText(input.task, SUBAGENT_CONTROL_TASK_MAX_CHARS),
  };
  if (input.childSessionId) next.childSessionId = input.childSessionId;
  if (input.predecessorResult) next.predecessorResult = copyResultRef(input.predecessorResult);
  if (input.reviewRef) next.reviewRef = copyReviewRef(input.reviewRef);
  return next;
}

export function boundSubagentControlDisplay(
  input: SubagentControlDisplay,
): SubagentControlDisplay {
  switch (input.phase) {
    case 'accepted':
      return boundAcceptedDisplay(input);
    case 'waiting':
    case 'waited':
      return {
        phase: input.phase,
        total: input.total,
        completed: input.completed,
        failed: input.failed,
        cancelled: input.cancelled,
        needsIntegration: input.needsIntegration,
        runs: input.runs
          .slice(0, SUBAGENT_CONTROL_MAX_RUNS)
          .map((run) => boundSubagentControlRunDisplay(run)),
      };
    case 'cancelling':
    case 'cancelled':
      return {
        phase: input.phase,
        total: input.total,
        cancelled: input.cancelled,
        alreadyTerminal: input.alreadyTerminal,
        runs: input.runs
          .slice(0, SUBAGENT_CONTROL_MAX_RUNS)
          .map((run) => boundSubagentControlRunDisplay(run)),
      };
  }
}

function defaultResultReadSummary(mode: SubagentResultReadMode): string {
  switch (mode) {
    case 'summary':
      return 'Result summary';
    case 'files':
      return 'Result files';
    case 'diff':
      return 'Result diff';
  }
}

export function boundSubagentLoopControlDisplay(
  input: SubagentLoopControlDisplay,
): SubagentLoopControlDisplay {
  switch (input.kind) {
    case 'result-read':
      return {
        kind: 'result-read',
        result: copyResultRef(input.result),
        mode: input.mode,
        summary: boundSubagentControlText(
          input.summary || defaultResultReadSummary(input.mode),
          SUBAGENT_CONTROL_ACTIVITY_MAX_CHARS,
        ),
      };
    case 'review-submit':
      return {
        kind: 'review-submit',
        reviewRef: copyReviewRef(input.reviewRef),
        decision: input.decision,
        target: copyResultRef(input.target),
      };
    case 'result-apply':
      return {
        kind: 'result-apply',
        result: copyResultRef(input.result),
        operationId: input.operationId,
        integrationStatus: input.integrationStatus,
      };
    case 'verification-submit':
      return {
        kind: 'verification-submit',
        result: copyResultRef(input.result),
        verificationRef: copyVerificationRef(input.verificationRef),
        status: input.status,
      };
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readPositiveInt(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) return undefined;
  return value;
}

function readResultRef(value: unknown): SubagentResultRef | undefined {
  if (!isRecord(value) || !isNonEmptyString(value.resultId)) return undefined;
  const revision = readPositiveInt(value.revision);
  if (revision === undefined) return undefined;
  return { resultId: value.resultId, revision };
}

function readReviewRef(value: unknown): SubagentReviewRef | undefined {
  if (!isRecord(value) || !isNonEmptyString(value.reviewId)) return undefined;
  const revision = readPositiveInt(value.revision);
  if (revision === undefined) return undefined;
  return { reviewId: value.reviewId, revision };
}

function readVerificationRef(value: unknown): SubagentVerificationRef | undefined {
  if (!isRecord(value) || !isNonEmptyString(value.verificationId)) return undefined;
  const revision = readPositiveInt(value.revision);
  if (revision === undefined) return undefined;
  return { verificationId: value.verificationId, revision };
}

function isSubagentControlRunDisplay(value: unknown): value is SubagentControlRunDisplay {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  if (!isNonEmptyString(record.runId)) return false;
  if (
    typeof record.executionStatus !== 'string' ||
    !EXECUTION_STATUSES.has(record.executionStatus)
  ) {
    return false;
  }
  for (const key of ['invocationId', 'childSessionId', 'title', 'activity', 'summaryPreview'] as const) {
    if (record[key] !== undefined && !isNonEmptyString(record[key])) return false;
  }
  if (
    record.summaryStatus !== undefined &&
    (typeof record.summaryStatus !== 'string' || !SUMMARY_STATUSES.has(record.summaryStatus))
  ) {
    return false;
  }
  if (
    record.integrationStatus !== undefined &&
    (typeof record.integrationStatus !== 'string' ||
      !INTEGRATION_STATUSES.has(record.integrationStatus))
  ) {
    return false;
  }
  return true;
}

/** Read and re-bound subagent control presentation from tool details. */
export function readSubagentControlDisplay(value: unknown): SubagentControlDisplay | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const record = value as Record<string, unknown>;
  const phase = record.phase;
  if (phase === 'accepted') {
    if (
      !isNonEmptyString(record.runId) ||
      !isNonEmptyString(record.invocationId) ||
      !isNonEmptyString(record.task)
    ) {
      return undefined;
    }
    const childSessionId = isNonEmptyString(record.childSessionId) ? record.childSessionId : undefined;
    const predecessorResult = readResultRef(record.predecessorResult);
    const reviewRef = readReviewRef(record.reviewRef);
    return boundSubagentControlDisplay({
      phase: 'accepted',
      runId: record.runId,
      invocationId: record.invocationId,
      task: record.task,
      ...(childSessionId ? { childSessionId } : {}),
      ...(predecessorResult ? { predecessorResult } : {}),
      ...(reviewRef ? { reviewRef } : {}),
    });
  }
  if (phase === 'waiting' || phase === 'waited') {
    if (
      typeof record.total !== 'number' ||
      typeof record.completed !== 'number' ||
      typeof record.failed !== 'number' ||
      typeof record.cancelled !== 'number' ||
      typeof record.needsIntegration !== 'number' ||
      !Array.isArray(record.runs)
    ) {
      return undefined;
    }
    const runs = record.runs.filter(isSubagentControlRunDisplay);
    return boundSubagentControlDisplay({
      phase,
      total: record.total,
      completed: record.completed,
      failed: record.failed,
      cancelled: record.cancelled,
      needsIntegration: record.needsIntegration,
      runs,
    });
  }
  if (phase === 'cancelling' || phase === 'cancelled') {
    if (
      typeof record.total !== 'number' ||
      typeof record.cancelled !== 'number' ||
      typeof record.alreadyTerminal !== 'number' ||
      !Array.isArray(record.runs)
    ) {
      return undefined;
    }
    const runs = record.runs.filter(isSubagentControlRunDisplay);
    return boundSubagentControlDisplay({
      phase,
      total: record.total,
      cancelled: record.cancelled,
      alreadyTerminal: record.alreadyTerminal,
      runs,
    });
  }
  return undefined;
}

/**
 * Read Host-normalized review-loop presentation. Output-like keys are ignored;
 * a missing decision/status never falls back to `"approved"` / `"passed"` text.
 */
export function readSubagentLoopControlDisplay(value: unknown): SubagentLoopControlDisplay | undefined {
  if (!isRecord(value)) return undefined;
  const kind = value.kind;
  if (kind === 'result-read') {
    const result = readResultRef(value.result);
    const mode = value.mode;
    if (!result || typeof mode !== 'string' || !RESULT_READ_MODES.has(mode)) return undefined;
    const typedMode = mode as SubagentResultReadMode;
    const summary =
      typeof value.summary === 'string' && value.summary.trim()
        ? value.summary
        : defaultResultReadSummary(typedMode);
    return boundSubagentLoopControlDisplay({
      kind: 'result-read',
      result,
      mode: typedMode,
      summary,
    });
  }
  if (kind === 'review-submit') {
    const reviewRef = readReviewRef(value.reviewRef);
    const target = readResultRef(value.target);
    const decision = value.decision;
    if (
      !reviewRef ||
      !target ||
      typeof decision !== 'string' ||
      !REVIEW_DECISIONS.has(decision)
    ) {
      return undefined;
    }
    return boundSubagentLoopControlDisplay({
      kind: 'review-submit',
      reviewRef,
      decision: decision as SubagentReviewDecision,
      target,
    });
  }
  if (kind === 'result-apply') {
    const result = readResultRef(value.result);
    const operationId = value.operationId;
    const integrationStatus = value.integrationStatus;
    if (
      !result ||
      !isNonEmptyString(operationId) ||
      typeof integrationStatus !== 'string' ||
      !INTEGRATION_STATUSES.has(integrationStatus)
    ) {
      return undefined;
    }
    return boundSubagentLoopControlDisplay({
      kind: 'result-apply',
      result,
      operationId,
      integrationStatus: integrationStatus as SubagentIntegrationStatus,
    });
  }
  if (kind === 'verification-submit') {
    const result = readResultRef(value.result);
    const verificationRef = readVerificationRef(value.verificationRef);
    const status = value.status;
    if (
      !result ||
      !verificationRef ||
      typeof status !== 'string' ||
      !VERIFICATION_STATUSES.has(status)
    ) {
      return undefined;
    }
    return boundSubagentLoopControlDisplay({
      kind: 'verification-submit',
      result,
      verificationRef,
      status: status as 'passed' | 'failed',
    });
  }
  return undefined;
}
