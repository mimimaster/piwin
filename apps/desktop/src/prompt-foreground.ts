/**
 * Desktop prompt admission: normal Send is if-idle; only a confirmed
 * “中断并发送” uses replace-run. Callers never infer mismatch from error text.
 */
import type {
  ForegroundRunMismatchProblem,
  ForegroundRunMismatchReason,
  HostResponse,
  PromptForegroundAdmission,
  PromptInput,
  RemoteCapabilitySummary,
} from '@piwin/contracts';
import { getDesktopCopy, type DesktopLocale } from './desktop-locale';

const MISMATCH_REASONS: ReadonlySet<ForegroundRunMismatchReason> = new Set([
  'active',
  'changed',
  'already-finished',
  'transitioning',
]);

const CONFIRMABLE_REASONS: ReadonlySet<ForegroundRunMismatchReason> = new Set([
  'active',
  'transitioning',
]);

export type SessionPromptCommand = {
  type: 'session/prompt';
  sessionId: string;
  input: PromptInput;
  foreground: PromptForegroundAdmission;
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
    reason: 'active' | 'transitioning';
    actualRun: { runId: string; status?: 'queued' | 'running' | 'cancelling' };
  };
} {
  const runId = problem.data.actualRun?.runId?.trim();
  return CONFIRMABLE_REASONS.has(problem.data.reason) && typeof runId === 'string' && runId.length > 0;
}

/** True only when a remote Host advertised prompt admission. Local sidecar is always allowed. */
export function hostSupportsForegroundAdmission(
  capabilities: RemoteCapabilitySummary | undefined,
): boolean {
  return capabilities?.foregroundRunAdmission === true;
}

export function canSendForegroundPrompt(input: {
  transport: 'mock' | 'live' | 'remote';
  capabilities?: RemoteCapabilitySummary;
}): boolean {
  return input.transport !== 'remote' || hostSupportsForegroundAdmission(input.capabilities);
}

export function foregroundMismatchNotice(
  problem: ForegroundRunMismatchProblem,
  locale: DesktopLocale,
): string {
  const copy = getDesktopCopy(locale).composer;
  switch (problem.data.reason) {
    case 'already-finished':
      return copy.foregroundMismatchFinished;
    case 'changed':
      return copy.foregroundMismatchChanged;
    case 'active':
    case 'transitioning':
      return copy.foregroundReplaceDescription;
  }
}

export function supersededByNewPromptNotice(locale: DesktopLocale): string {
  return getDesktopCopy(locale).composer.supersededByNewPrompt;
}

export async function requestPromptWithForeground(args: {
  request: (command: SessionPromptCommand) => Promise<HostResponse>;
  sessionId: string;
  input: PromptInput;
  confirmReplace?: (problem: ForegroundRunMismatchProblem) => Promise<boolean>;
  allowReplaceConfirm?: boolean;
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
  };
  const first = await args.request({
    ...commandBase,
    foreground: nextPromptForeground({}),
  });
  const problem = readForegroundProblem(first);
  if (problem === undefined) {
    return first;
  }
  if (
    args.allowReplaceConfirm !== false &&
    args.confirmReplace !== undefined &&
    canConfirmReplaceRun(problem)
  ) {
    const confirmed = await args.confirmReplace(problem);
    if (confirmed) {
      return args.request({
        ...commandBase,
        foreground: nextPromptForeground({
          confirmedReplaceRunId: problem.data.actualRun.runId,
        }),
      });
    }
  }
  return first;
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
