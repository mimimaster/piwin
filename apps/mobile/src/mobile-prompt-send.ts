import type { HostCommand, HostProblem, HostResponse, MediaAttachmentRef, ModelRef, ThinkingLevel } from '@piwin/contracts';

export type MobilePromptTurn = {
  sessionId: string;
  text: string;
  attachments?: MediaAttachmentRef[];
  model?: ModelRef;
  thinkingLevel?: ThinkingLevel;
  replaceRunId?: string;
};

export type MobilePromptFailure = {
  message: string;
  replaceRunId?: string;
};

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
