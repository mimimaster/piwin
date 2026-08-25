import type {
  HostCommand,
  HostProblem,
  HostResponse,
  MediaAttachmentRef,
  ModelRef,
  PromptContextRef,
  ThinkingLevel,
} from '@piwin/contracts';
import {
  createHostRequestAttempt,
  createIdempotencyKey,
  executeHostRequestAttempt,
  foregroundMutationsEnabled,
  knownForegroundRunId,
  type ForegroundRunState,
  type HostRequestExecutor,
} from '@piwin/host-client';

export type MobilePromptTurn = {
  sessionId: string;
  text: string;
  attachments?: MediaAttachmentRef[];
  model?: ModelRef;
  thinkingLevel?: ThinkingLevel;
  replaceRunId?: string;
  includeAppleHealth?: boolean;
};

export const APPLE_HEALTH_CONTEXT_REF: PromptContextRef = {
  kind: 'connected-source',
  source: 'apple-health',
  label: 'Apple Health',
};

export type MobilePromptFailure = {
  message: string;
  replaceRunId?: string;
};

export type MobileBusyChoice = 'queue' | 'replace' | 'dismiss';

export type MobileSendIntent =
  | { kind: 'disabled' }
  | { kind: 'prompt'; command: Extract<HostCommand, { type: 'session/prompt' }> }
  | {
      kind: 'queued-turn';
      command: Extract<HostCommand, { type: 'session/queued-turn-submit' }>;
    };

export function createMobileIdempotencyKey(): string {
  return createIdempotencyKey();
}

export function nextMobileSendIntent(input: {
  sessionId: string;
  text: string;
  attachments?: MediaAttachmentRef[];
  model?: ModelRef;
  thinkingLevel?: ThinkingLevel;
  includeAppleHealth?: boolean;
  foreground: ForegroundRunState;
  replaceRunId?: string;
  queuedTurnId?: string;
  userMessageId?: string;
}): MobileSendIntent {
  if (!foregroundMutationsEnabled(input.foreground) && input.replaceRunId === undefined) {
    return { kind: 'disabled' };
  }
  if (input.replaceRunId !== undefined) {
    return {
      kind: 'prompt',
      command: buildMobileSessionPrompt({
        sessionId: input.sessionId,
        text: input.text,
        ...(input.attachments === undefined ? {} : { attachments: input.attachments }),
        ...(input.model === undefined ? {} : { model: input.model }),
        ...(input.thinkingLevel === undefined ? {} : { thinkingLevel: input.thinkingLevel }),
        ...(input.includeAppleHealth === true ? { includeAppleHealth: true } : {}),
        replaceRunId: input.replaceRunId,
      }),
    };
  }
  const activeRunId = knownForegroundRunId(input.foreground);
  if (activeRunId !== undefined) {
    return {
      kind: 'queued-turn',
      command: {
        type: 'session/queued-turn-submit',
        sessionId: input.sessionId,
        queuedTurnId: input.queuedTurnId ?? createMobileIdempotencyKey(),
        userMessageId: input.userMessageId ?? createMobileIdempotencyKey(),
        input: {
          text: input.text,
          ...(input.attachments === undefined || input.attachments.length === 0
            ? {}
            : { attachments: input.attachments }),
          ...(input.model === undefined ? {} : { model: input.model }),
          ...(input.thinkingLevel === undefined ? {} : { thinkingLevel: input.thinkingLevel }),
          ...(input.includeAppleHealth === true ? { contextRefs: [APPLE_HEALTH_CONTEXT_REF] } : {}),
        },
      },
    };
  }
  return {
    kind: 'prompt',
    command: buildMobileSessionPrompt({
      sessionId: input.sessionId,
      text: input.text,
      ...(input.attachments === undefined ? {} : { attachments: input.attachments }),
      ...(input.model === undefined ? {} : { model: input.model }),
      ...(input.thinkingLevel === undefined ? {} : { thinkingLevel: input.thinkingLevel }),
      ...(input.includeAppleHealth === true ? { includeAppleHealth: true } : {}),
    }),
  };
}

export function buildMobileAbortCommand(
  sessionId: string,
  runId: string,
): Extract<HostCommand, { type: 'session/abort' }> {
  return { type: 'session/abort', sessionId, runId };
}

export function buildMobilePermissionResolveCommand(
  requestId: string,
  decision: 'allow' | 'deny',
): Extract<HostCommand, { type: 'permission/resolve' }> {
  return {
    type: 'permission/resolve',
    requestId,
    decision,
    rememberScope: 'once',
  };
}

export function executeMobileMutation(
  request: HostRequestExecutor,
  command: HostCommand,
  idempotencyKey: string,
): Promise<HostResponse> {
  return executeHostRequestAttempt(request, createHostRequestAttempt(command, idempotencyKey));
}

export function buildMobileSessionPrompt(turn: MobilePromptTurn): Extract<HostCommand, { type: 'session/prompt' }> {
  return {
    type: 'session/prompt',
    sessionId: turn.sessionId,
    input: {
      text: turn.text,
      ...(turn.attachments === undefined || turn.attachments.length === 0
        ? {}
        : { attachments: turn.attachments }),
      ...(turn.model === undefined ? {} : { model: turn.model }),
      ...(turn.thinkingLevel === undefined ? {} : { thinkingLevel: turn.thinkingLevel }),
      ...(turn.includeAppleHealth === true ? { contextRefs: [APPLE_HEALTH_CONTEXT_REF] } : {}),
    },
    foreground:
      turn.replaceRunId === undefined
        ? { kind: 'if-idle' }
        : { kind: 'replace-run', runId: turn.replaceRunId },
  };
}

export function readMobilePromptFailure(response: HostResponse): MobilePromptFailure | undefined {
  if (response.success) {
    return undefined;
  }
  const replaceRunId = readForegroundReplaceRunId(response.problem);
  return {
    message: response.error,
    ...(replaceRunId === undefined ? {} : { replaceRunId }),
  };
}

function readForegroundReplaceRunId(problem: HostProblem | undefined): string | undefined {
  if (problem === undefined || problem.code !== 'foreground-run-mismatch') {
    return undefined;
  }
  if (typeof problem.data !== 'object' || problem.data === null) {
    return undefined;
  }
  const data = problem.data as Record<string, unknown>;
  if (typeof data.actualRun !== 'object' || data.actualRun === null) {
    return undefined;
  }
  const actualRun = data.actualRun as Record<string, unknown>;
  return typeof actualRun.runId === 'string' && actualRun.runId.length > 0 ? actualRun.runId : undefined;
}
