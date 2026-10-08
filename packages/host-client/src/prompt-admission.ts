/**
 * Prompt foreground admission, shared by every shell. A normal send is
 * if-idle; a refused send either queues on the Host, replaces the running
 * turn after a confirmed choice, or is reported. Callers never infer a
 * mismatch from error text, only from the typed problem.
 */
import type {
  ForegroundRunMismatchProblem,
  ForegroundRunMismatchReason,
  HostResponse,
  PromptForegroundAdmission,
  PromptInput,
} from '@piwin/contracts';

const MISMATCH_REASONS: ReadonlySet<ForegroundRunMismatchReason> = new Set([
  'active',
  'changed',
  'already-finished',
  'transitioning',
]);

const CONFIRMABLE_REASONS: ReadonlySet<ForegroundRunMismatchReason> = new Set(['active']);

/** A turn is running or about to: the prompt can wait behind it in the Host queue. */
const BUSY_REASONS: ReadonlySet<ForegroundRunMismatchReason> = new Set(['active', 'transitioning']);

export type BusyRunChoice = 'queue' | 'replace' | 'dismiss';

export type SessionPromptCommand = {
  type: 'session/prompt';
  sessionId: string;
  input: PromptInput;
  foreground: PromptForegroundAdmission;
  confirm?: boolean;
};

export function nextPromptForeground(input: {
  confirmedReplaceRunId?: string;
}): PromptForegroundAdmission {
  const runId = input.confirmedReplaceRunId?.trim();
  if (runId) {
    return { kind: 'replace-run', runId };
  }
  return { kind: 'if-idle' };
}

export function readForegroundProblem(
  response: HostResponse,
): ForegroundRunMismatchProblem | undefined {
  if (response.success) {
    return undefined;
  }
  return parseForegroundProblem(response.problem);
}

export function canConfirmReplaceRun(
  problem: ForegroundRunMismatchProblem,
): problem is ForegroundRunMismatchProblem & {
  data: {
    reason: 'active';
    actualRun: { runId: string; status?: 'queued' | 'running' | 'cancelling' };
  };
} {
  const runId = problem.data.actualRun?.runId?.trim();
  return CONFIRMABLE_REASONS.has(problem.data.reason) && typeof runId === 'string' && runId.length > 0;
}

/**
 * True when the refusal only means "a turn got there first". The shell may
 * not have seen that turn yet: its running push can still be in flight.
 */
export function isBusyForegroundProblem(problem: ForegroundRunMismatchProblem): boolean {
  return BUSY_REASONS.has(problem.data.reason);
}

export async function requestPromptWithForeground(args: {
  request: (
    command: SessionPromptCommand,
    options?: { idempotencyKey?: string },
  ) => Promise<HostResponse>;
  sessionId: string;
  input: PromptInput;
  resolveBusy?: (problem: ForegroundRunMismatchProblem) => Promise<BusyRunChoice>;
  confirmReplace?: (problem: ForegroundRunMismatchProblem) => Promise<boolean>;
  onQueue?: (problem: ForegroundRunMismatchProblem) => Promise<HostResponse>;
  /**
   * Queue without asking whenever a turn is already running or starting
   * (needs `onQueue`). For shells whose plain send means "after this turn".
   */
  queueWhenBusy?: boolean;
  allowReplaceConfirm?: boolean;
  createIdempotencyKey?: () => string;
  /** Confirm discarding a previous attempt that wrote files (ADR 0064). */
  confirm?: boolean;
  /**
   * Remote-only gate. When false, the Host hello lacked
   * `foregroundRunAdmission` and this client must not send prompts.
   * Local JSONL / mock omit this (treated as allowed).
   */
  remoteForegroundAdmission?: boolean;
}): Promise<HostResponse> {
  if (args.remoteForegroundAdmission === false) {
    return {
      type: 'response',
      command: 'session/prompt',
      success: false,
      error: 'host-too-old: foregroundRunAdmission required',
      problem: { code: 'host-too-old' },
    };
  }
  const commandBase = {
    type: 'session/prompt' as const,
    sessionId: args.sessionId,
    input: args.input,
    ...(args.confirm === true ? { confirm: true } : {}),
  };
  const nextKey = (): { idempotencyKey?: string } => {
    const key = args.createIdempotencyKey?.();
    return key === undefined ? {} : { idempotencyKey: key };
  };
  const first = await args.request(
    {
      ...commandBase,
      foreground: nextPromptForeground({}),
    },
    nextKey(),
  );
  const problem = readForegroundProblem(first);
  if (problem === undefined) {
    return first;
  }
  if (args.queueWhenBusy === true && args.onQueue !== undefined && isBusyForegroundProblem(problem)) {
    return args.onQueue(problem);
  }
  if (args.allowReplaceConfirm === false) {
    return first;
  }
  const choice = await resolveBusyChoice(problem, args);
  if (choice === 'queue' && args.onQueue !== undefined) {
    return args.onQueue(problem);
  }
  if (choice === 'replace' && canConfirmReplaceRun(problem)) {
    return args.request(
      {
        ...commandBase,
        foreground: nextPromptForeground({
          confirmedReplaceRunId: problem.data.actualRun.runId,
        }),
      },
      nextKey(),
    );
  }
  return first;
}

async function resolveBusyChoice(
  problem: ForegroundRunMismatchProblem,
  args: {
    resolveBusy?: (problem: ForegroundRunMismatchProblem) => Promise<BusyRunChoice>;
    confirmReplace?: (problem: ForegroundRunMismatchProblem) => Promise<boolean>;
  },
): Promise<BusyRunChoice> {
  if (!canConfirmReplaceRun(problem)) {
    return 'dismiss';
  }
  if (args.resolveBusy !== undefined) {
    return args.resolveBusy(problem);
  }
  if (args.confirmReplace !== undefined) {
    return (await args.confirmReplace(problem)) ? 'replace' : 'dismiss';
  }
  return 'dismiss';
}

function parseForegroundProblem(value: unknown): ForegroundRunMismatchProblem | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  const record = value as { code?: unknown; data?: unknown };
  if (record.code !== 'foreground-run-mismatch' || !record.data || typeof record.data !== 'object') {
    return undefined;
  }
  const data = record.data as { reason?: unknown; actualRun?: unknown; runId?: unknown };
  if (typeof data.reason !== 'string' || !MISMATCH_REASONS.has(data.reason as ForegroundRunMismatchReason)) {
    return undefined;
  }
  const reason = data.reason as ForegroundRunMismatchReason;
  const actualRun = parseActualRun(data.actualRun, data.runId);
  return actualRun === undefined
    ? { code: 'foreground-run-mismatch', data: { reason } }
    : { code: 'foreground-run-mismatch', data: { reason, actualRun } };
}

function parseActualRun(
  value: unknown,
  fallbackRunId?: unknown,
): ForegroundRunMismatchProblem['data']['actualRun'] | undefined {
  if (value && typeof value === 'object') {
    const record = value as { runId?: unknown; status?: unknown };
    if (typeof record.runId === 'string' && record.runId.trim().length > 0) {
      const runId = record.runId.trim();
      if (record.status === 'queued' || record.status === 'running' || record.status === 'cancelling') {
        return { runId, status: record.status };
      }
      // HostServer projects `{ actualRun: { runId } }` with status stripped.
      return { runId };
    }
  }
  if (typeof fallbackRunId === 'string' && fallbackRunId.trim().length > 0) {
    return { runId: fallbackRunId.trim() };
  }
  return undefined;
}
