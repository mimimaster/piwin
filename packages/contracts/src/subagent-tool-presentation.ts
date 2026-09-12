/**
 * Host-normalized async subagent control-tool presentation.
 *
 * Desktop renders these shapes only — never raw child transcripts or Pi-native
 * tool details. IDs are opaque links; display strings are bounded at the Host
 * boundary before they reach clients.
 */

import type {
  SubagentExecutionStatus,
  SubagentIntegrationStatus,
  SubagentSummaryStatus,
} from './subagent-lifecycle.js';

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

export function boundSubagentControlDisplay(
  input: SubagentControlDisplay,
): SubagentControlDisplay {
  switch (input.phase) {
    case 'accepted':
      return {
        phase: 'accepted',
        runId: input.runId,
        invocationId: input.invocationId,
        task: boundSubagentControlText(input.task, SUBAGENT_CONTROL_TASK_MAX_CHARS),
      };
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

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
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
    return boundSubagentControlDisplay({
      phase: 'accepted',
      runId: record.runId,
      invocationId: record.invocationId,
      task: record.task,
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
