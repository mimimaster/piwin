import {
  boundSubagentControlDisplay,
  readSubagentControlDisplay,
  readSubagentLoopControlDisplay,
  type SubagentControlDisplay,
  type SubagentLoopControlDisplay,
  type ToolPresentation,
} from '@piwin/contracts';

export type AttachSubagentPresentationInput = {
  toolName: string;
  routedToolName?: string;
  args?: unknown;
  details?: unknown;
  isError?: boolean;
};

function normalizeToolName(name: string | undefined): string {
  return (name ?? '').trim().toLowerCase();
}

function toolNameIs(name: string | undefined, expected: string): boolean {
  return normalizeToolName(name) === expected;
}

function matchesTool(input: AttachSubagentPresentationInput, expected: string): boolean {
  return toolNameIs(input.routedToolName ?? input.toolName, expected) || toolNameIs(input.toolName, expected);
}

function isSubagentStartTool(input: AttachSubagentPresentationInput): boolean {
  return matchesTool(input, 'piwin_subagent_start') || matchesTool(input, 'piwin_subagent_continue');
}

function isSubagentContinueTool(input: AttachSubagentPresentationInput): boolean {
  return matchesTool(input, 'piwin_subagent_continue');
}

function isSubagentWaitTool(input: AttachSubagentPresentationInput): boolean {
  return matchesTool(input, 'piwin_subagent_wait');
}

function isSubagentCancelTool(input: AttachSubagentPresentationInput): boolean {
  return matchesTool(input, 'piwin_subagent_cancel');
}

function isSubagentLoopTool(input: AttachSubagentPresentationInput): boolean {
  return (
    matchesTool(input, 'piwin_subagent_result_read') ||
    matchesTool(input, 'piwin_subagent_review_submit') ||
    matchesTool(input, 'piwin_subagent_result_apply') ||
    matchesTool(input, 'piwin_subagent_verification_submit')
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function parseRunIds(args: unknown): string[] | undefined {
  if (!isRecord(args)) return undefined;
  const runIds = args.runIds;
  if (!Array.isArray(runIds)) return undefined;
  const parsed = runIds
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .map((value) => value.trim());
  return parsed.length > 0 ? parsed : undefined;
}

function readControlDisplayFromDetails(details: unknown): SubagentControlDisplay | undefined {
  const direct = readSubagentControlDisplay(details);
  if (direct) return direct;
  if (!isRecord(details)) return undefined;
  return readSubagentControlDisplay(details.controlDisplay);
}

function parseStartAcceptedDisplay(
  details: unknown,
  args: unknown,
): SubagentControlDisplay | undefined {
  if (!isRecord(details)) return undefined;
  const runId = readString(details.runId);
  const invocationId = readString(details.invocationId);
  const status = readString(details.status);
  if (!runId || !invocationId || status !== 'accepted') return undefined;
  const task = isRecord(args) ? readString(args.task) : undefined;
  if (!task) return undefined;
  const childSessionId =
    readString(details.childSessionId) ?? (isRecord(args) ? readString(args.childSessionId) : undefined);
  const predecessorResult = details.predecessorResult ?? (isRecord(args) ? args.expectedResult : undefined);
  const reviewRef = details.reviewRef ?? (isRecord(args) ? args.review : undefined);
  return readSubagentControlDisplay({
    phase: 'accepted',
    runId,
    invocationId,
    task,
    ...(childSessionId ? { childSessionId } : {}),
    ...(predecessorResult !== undefined ? { predecessorResult } : {}),
    ...(reviewRef !== undefined ? { reviewRef } : {}),
  });
}

function buildWaitingDisplay(runIds: readonly string[]): SubagentControlDisplay {
  return boundSubagentControlDisplay({
    phase: 'waiting',
    total: runIds.length,
    completed: 0,
    failed: 0,
    cancelled: 0,
    needsIntegration: 0,
    runs: runIds.map((runId) => ({
      runId,
      executionStatus: 'running',
    })),
  });
}

function buildCancellingDisplay(runIds: readonly string[]): SubagentControlDisplay {
  return boundSubagentControlDisplay({
    phase: 'cancelling',
    total: runIds.length,
    cancelled: 0,
    alreadyTerminal: 0,
    runs: runIds.map((runId) => ({
      runId,
      executionStatus: 'running',
    })),
  });
}

function controlActionVerb(control: SubagentControlDisplay, continued: boolean): string {
  switch (control.phase) {
    case 'accepted':
      return continued ? 'Continued' : 'Delegated';
    case 'waiting':
      return 'Waiting for subagents';
    case 'waited':
      return 'Subagent wait';
    case 'cancelling':
      return 'Cancelling subagents';
    case 'cancelled':
      return 'Subagent cancel';
  }
}

function controlSummary(control: SubagentControlDisplay): string {
  switch (control.phase) {
    case 'accepted':
      return control.task;
    case 'waiting':
      return `${control.total} run${control.total === 1 ? '' : 's'} pending`;
    case 'waited': {
      const parts: string[] = [];
      if (control.completed > 0) parts.push(`${control.completed} completed`);
      if (control.failed > 0) parts.push(`${control.failed} failed`);
      if (control.cancelled > 0) parts.push(`${control.cancelled} cancelled`);
      if (control.needsIntegration > 0) {
        parts.push(`${control.needsIntegration} need integration`);
      }
      return parts.length > 0 ? parts.join(', ') : `${control.total} runs`;
    }
    case 'cancelling':
      return `${control.total} run${control.total === 1 ? '' : 's'}`;
    case 'cancelled':
      return `${control.cancelled} cancelled, ${control.alreadyTerminal} already terminal`;
  }
}

function resolveSubagentControl(
  input: AttachSubagentPresentationInput,
): SubagentControlDisplay | undefined {
  if (input.isError) return undefined;

  if (isSubagentStartTool(input)) {
    return parseStartAcceptedDisplay(input.details, input.args);
  }

  const runIds = parseRunIds(input.args);
  const fromDetails = readControlDisplayFromDetails(input.details);

  if (isSubagentWaitTool(input)) {
    if (fromDetails) return fromDetails;
    if (runIds) return buildWaitingDisplay(runIds);
    return undefined;
  }

  if (isSubagentCancelTool(input)) {
    if (fromDetails) return fromDetails;
    if (runIds) return buildCancellingDisplay(runIds);
    return undefined;
  }

  return undefined;
}

function parseResultReadDisplay(
  details: unknown,
  args: unknown,
): SubagentLoopControlDisplay | undefined {
  const mode = (isRecord(details) ? details.mode : undefined) ?? (isRecord(args) ? args.mode : undefined);
  const result =
    (isRecord(details) ? details.result : undefined) ?? (isRecord(args) ? args.result : undefined);
  return readSubagentLoopControlDisplay({
    kind: 'result-read',
    result,
    mode,
  });
}

function parseReviewSubmitDisplay(details: unknown): SubagentLoopControlDisplay | undefined {
  if (!isRecord(details)) return undefined;
  return readSubagentLoopControlDisplay({
    kind: 'review-submit',
    reviewRef: details.reviewRef,
    decision: details.decision,
    target: details.target,
  });
}

function parseResultApplyDisplay(
  details: unknown,
  args: unknown,
): SubagentLoopControlDisplay | undefined {
  if (!isRecord(details)) return undefined;
  return readSubagentLoopControlDisplay({
    kind: 'result-apply',
    result: details.result ?? (isRecord(args) ? args.result : undefined),
    operationId: details.operationId,
    integrationStatus: details.integrationStatus,
  });
}

function parseVerificationDisplay(
  details: unknown,
  args: unknown,
): SubagentLoopControlDisplay | undefined {
  if (!isRecord(details)) return undefined;
  return readSubagentLoopControlDisplay({
    kind: 'verification-submit',
    result: details.result ?? (isRecord(args) ? args.result : undefined),
    verificationRef: details.verificationRef,
    status: details.status,
  });
}

function resolveLoopControl(
  input: AttachSubagentPresentationInput,
): SubagentLoopControlDisplay | undefined {
  if (input.isError) return undefined;
  if (matchesTool(input, 'piwin_subagent_result_read')) {
    return parseResultReadDisplay(input.details, input.args);
  }
  if (matchesTool(input, 'piwin_subagent_review_submit')) {
    return parseReviewSubmitDisplay(input.details);
  }
  if (matchesTool(input, 'piwin_subagent_result_apply')) {
    return parseResultApplyDisplay(input.details, input.args);
  }
  if (matchesTool(input, 'piwin_subagent_verification_submit')) {
    return parseVerificationDisplay(input.details, input.args);
  }
  return undefined;
}

function loopActionVerb(loop: SubagentLoopControlDisplay): string {
  switch (loop.kind) {
    case 'result-read':
      return 'Read result';
    case 'review-submit':
      return 'Reviewed';
    case 'result-apply':
      return 'Applied';
    case 'verification-submit':
      return loop.status === 'failed' ? 'Verification failed' : 'Verified';
  }
}

function loopSummary(loop: SubagentLoopControlDisplay): string {
  switch (loop.kind) {
    case 'result-read':
      return loop.summary;
    case 'review-submit':
      return loop.decision === 'changes-requested' ? 'changes requested' : loop.decision;
    case 'result-apply':
      return loop.integrationStatus;
    case 'verification-submit':
      return loop.status;
  }
}

function applyControlPresentation(
  presentation: ToolPresentation,
  control: SubagentControlDisplay,
  invocation: boolean,
  continued: boolean,
): ToolPresentation {
  const next: ToolPresentation = {
    ...presentation,
    subagentControl: control,
    actionVerb: controlActionVerb(control, continued),
    summary: controlSummary(control),
  };
  if (invocation) {
    next.kind = 'subagent';
    next.title = 'Subagent';
  } else {
    next.kind = 'other';
  }
  return next;
}

function applyLoopPresentation(
  presentation: ToolPresentation,
  loop: SubagentLoopControlDisplay,
): ToolPresentation {
  return {
    ...presentation,
    kind: 'other',
    subagentLoop: loop,
    actionVerb: loopActionVerb(loop),
    summary: loopSummary(loop),
  };
}

/**
 * Attach bounded async subagent control presentation from tool args/details.
 * Malformed payloads are ignored so Desktop falls back to a generic tool card.
 */
export function attachSubagentPresentation(
  presentation: ToolPresentation,
  input: AttachSubagentPresentationInput,
): ToolPresentation {
  const isStart = isSubagentStartTool(input);
  const isWait = isSubagentWaitTool(input);
  const isCancel = isSubagentCancelTool(input);
  const isLoop = isSubagentLoopTool(input);
  if (!isStart && !isWait && !isCancel && !isLoop) {
    return presentation;
  }

  if (isLoop) {
    const loop = resolveLoopControl(input);
    if (!loop) {
      return { ...presentation, kind: 'other' };
    }
    return applyLoopPresentation(presentation, loop);
  }

  const control = resolveSubagentControl(input);
  if (!control) {
    if (isWait || isCancel) {
      return { ...presentation, kind: 'other' };
    }
    return presentation;
  }

  return applyControlPresentation(presentation, control, isStart, isSubagentContinueTool(input));
}
