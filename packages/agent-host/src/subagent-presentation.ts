import {
  boundSubagentControlDisplay,
  readSubagentControlDisplay,
  type SubagentControlDisplay,
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

function isSubagentStartTool(name: string | undefined): boolean {
  return normalizeToolName(name) === 'piwin_subagent_start';
}

function isSubagentWaitTool(name: string | undefined): boolean {
  return normalizeToolName(name) === 'piwin_subagent_wait';
}

function isSubagentCancelTool(name: string | undefined): boolean {
  return normalizeToolName(name) === 'piwin_subagent_cancel';
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
  return boundSubagentControlDisplay({
    phase: 'accepted',
    runId,
    invocationId,
    task,
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

function controlActionVerb(control: SubagentControlDisplay): string {
  switch (control.phase) {
    case 'accepted':
      return 'Delegated';
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
  const effectiveName = input.routedToolName ?? input.toolName;
  if (input.isError) return undefined;

  if (isSubagentStartTool(effectiveName) || isSubagentStartTool(input.toolName)) {
    return parseStartAcceptedDisplay(input.details, input.args);
  }

  const runIds = parseRunIds(input.args);
  const fromDetails = readControlDisplayFromDetails(input.details);

  if (isSubagentWaitTool(effectiveName) || isSubagentWaitTool(input.toolName)) {
    if (fromDetails) return fromDetails;
    if (runIds) return buildWaitingDisplay(runIds);
    return undefined;
  }

  if (isSubagentCancelTool(effectiveName) || isSubagentCancelTool(input.toolName)) {
    if (fromDetails) return fromDetails;
    if (runIds) return buildCancellingDisplay(runIds);
    return undefined;
  }

  return undefined;
}

function applyControlPresentation(
  presentation: ToolPresentation,
  control: SubagentControlDisplay,
  invocation: boolean,
): ToolPresentation {
  const next: ToolPresentation = {
    ...presentation,
    subagentControl: control,
    actionVerb: controlActionVerb(control),
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

/**
 * Attach bounded async subagent control presentation from tool args/details.
 * Malformed payloads are ignored so Desktop falls back to a generic tool card.
 */
export function attachSubagentPresentation(
  presentation: ToolPresentation,
  input: AttachSubagentPresentationInput,
): ToolPresentation {
  const effectiveName = input.routedToolName ?? input.toolName;
  const isStart = isSubagentStartTool(effectiveName) || isSubagentStartTool(input.toolName);
  const isWait = isSubagentWaitTool(effectiveName) || isSubagentWaitTool(input.toolName);
  const isCancel = isSubagentCancelTool(effectiveName) || isSubagentCancelTool(input.toolName);
  if (!isStart && !isWait && !isCancel) {
    return presentation;
  }

  const control = resolveSubagentControl(input);
  if (!control) {
    if (isWait || isCancel) {
      return { ...presentation, kind: 'other' };
    }
    return presentation;
  }

  return applyControlPresentation(presentation, control, isStart);
}
