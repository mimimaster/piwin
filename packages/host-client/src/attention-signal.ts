import type { ExecutionRunRecord, HostPush } from '@piwin/contracts';
import {
  isRunTerminal,
  RUN_TERMINAL_CODES,
  sanitizeActivityPermissionAction,
} from '@piwin/contracts';

export type AttentionKind = 'needs-input' | 'turn-complete' | 'turn-failed';
export type AttentionSource = 'permission' | 'question' | 'run';

export type AttentionRaise = {
  type: 'raise';
  kind: AttentionKind;
  key: string;
  sessionId: string;
  source: AttentionSource;
  runId?: string;
  permissionAction?: string;
  endedAt?: string;
};

export type AttentionSignal =
  | AttentionRaise
  | { type: 'settle'; sessionId: string; key: string }
  | { type: 'settle-questions'; sessionId: string };

const CANCELLED_FAILED_CODES = new Set<string>([
  RUN_TERMINAL_CODES.toolLoopStalled,
  RUN_TERMINAL_CODES.timeout,
  RUN_TERMINAL_CODES.jobCleanupFailed,
]);

const INTERRUPTED_SILENT_CODES = new Set<string>([
  RUN_TERMINAL_CODES.paused,
  RUN_TERMINAL_CODES.hostShutdown,
]);

export function classifyRunTerminalAttention(
  run: ExecutionRunRecord,
): 'turn-complete' | 'turn-failed' | 'silent' | null {
  if (!isRunTerminal(run.status)) {
    return null;
  }
  // AN-R02 footnote: integration-required on a session-turn is treated as failed.
  if (run.terminalCode === RUN_TERMINAL_CODES.integrationRequired) {
    return 'turn-failed';
  }
  switch (run.status) {
    case 'completed':
      return 'turn-complete';
    case 'failed':
      return 'turn-failed';
    case 'cancelled':
      return run.terminalCode !== undefined && CANCELLED_FAILED_CODES.has(run.terminalCode)
        ? 'turn-failed'
        : 'silent';
    case 'interrupted':
      return run.terminalCode !== undefined && INTERRUPTED_SILENT_CODES.has(run.terminalCode)
        ? 'silent'
        : 'turn-failed';
    default:
      return null;
  }
}

export function readAttentionSignals(push: HostPush): AttentionSignal[] {
  switch (push.type) {
    case 'permission/request': {
      const raise: AttentionRaise = {
        type: 'raise',
        kind: 'needs-input',
        key: `permission:${push.requestId}`,
        sessionId: push.sessionId,
        source: 'permission',
      };
      const permissionAction = sanitizeActivityPermissionAction(push.action);
      if (permissionAction !== undefined) {
        raise.permissionAction = permissionAction;
      }
      return [raise];
    }
    case 'permission/resolved':
      return [
        {
          type: 'settle',
          sessionId: push.sessionId,
          key: `permission:${push.requestId}`,
        },
      ];
    case 'extension/ui_request':
      return [
        {
          type: 'raise',
          kind: 'needs-input',
          key: `question:${push.requestId}`,
          sessionId: push.sessionId,
          source: 'question',
        },
      ];
    case 'run/terminal':
    case 'run/updated':
      return readRunAttentionSignals(push.run);
    default:
      return [];
  }
}

function readRunAttentionSignals(run: ExecutionRunRecord): AttentionSignal[] {
  if (run.kind !== 'session-turn') {
    return [];
  }
  const classification = classifyRunTerminalAttention(run);
  if (classification === null) {
    return [];
  }
  const settleQuestions: AttentionSignal = {
    type: 'settle-questions',
    sessionId: run.sessionId,
  };
  if (classification === 'silent') {
    return [settleQuestions];
  }
  const raise: AttentionRaise = {
    type: 'raise',
    kind: classification,
    key: `run:${run.runId}`,
    sessionId: run.sessionId,
    source: 'run',
    runId: run.runId,
  };
  if (run.endedAt !== undefined) {
    raise.endedAt = run.endedAt;
  }
  return [raise, settleQuestions];
}
