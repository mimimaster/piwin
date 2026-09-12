import type { SessionRunPhase } from '@piwin/contracts';
import type { RunStatusView, RunStatusKind } from './run-status.js';
import type { RunActivityInput } from './run-activity-types.js';
import type { TurnPresentation } from './run-presentation.js';
import type { ChatMessageUi } from './chat-reducer.js';

export function runStatusToActivityInput(
  runState: RunStatusView,
  locale: 'zh-CN' | 'en',
): RunActivityInput {
  return {
    kind: runState.kind,
    locale,
    ...(runState.activeToolName !== undefined
      ? { activeToolName: runState.activeToolName }
      : {}),
    ...(runState.planStep !== undefined ? { planStep: runState.planStep } : {}),
    ...(runState.elapsedMs !== undefined ? { elapsedMs: runState.elapsedMs } : {}),
    ...(runState.settlementDetail !== undefined
      ? {
          detail:
            runState.settlementDetail === 'synthesizing'
              ? 'synthesizing-reports'
              : 'joining-descendants',
        }
      : {}),
  };
}

export function turnPresentationToActivityInput(
  presentation: TurnPresentation,
  message: ChatMessageUi,
  locale: 'zh-CN' | 'en',
  now = Date.now(),
): RunActivityInput {
  const latestPhase = presentation.phaseHistory[presentation.phaseHistory.length - 1]?.phase;
  let kind = latestPhase ? sessionRunPhaseToActivityKind(latestPhase) : 'connecting-model';
  // Host may already report `streaming` while the bubble is still empty.
  // Prefer the waiting-first-token phrase bank so the carousel stays in the
  // "thinking / planning next step" register instead of generic "working".
  if (
    presentation.isWaitingForModel &&
    (kind === 'working' || kind === 'idle' || kind === 'complete')
  ) {
    kind = 'waiting-first-token';
  }
  const activeTool = message.tools.find((tool) => tool.status === 'running');
  const activeToolName = activeTool?.toolName;
  const activeToolDetail = activeTool
    ? resolveActiveToolDetail(activeTool)
    : undefined;
  const actionVerb = activeTool?.presentation?.actionVerb;
  // Round to nearest second so `input.elapsedMs` is stable across sub-second `TurnWorkDetails` re-renders.
  const elapsedMs =
    typeof presentation.startedAt === 'number'
      ? Math.floor((Math.max(0, now - presentation.startedAt)) / 1000) * 1000
      : undefined;

  return {
    kind,
    locale,
    ...(activeToolName !== undefined ? { activeToolName } : {}),
    ...(activeToolDetail !== undefined ? { detail: activeToolDetail } : {}),
    ...(actionVerb !== undefined ? { actionVerb } : {}),
    ...(elapsedMs !== undefined ? { elapsedMs } : {}),
  };
}

/** Prefer structured intent over stdout/stderr when describing live work. */
function resolveActiveToolDetail(tool: ChatMessageUi['tools'][number]): string | undefined {
  const presentation = tool.presentation;
  const detail =
    presentation?.command?.trim() ||
    presentation?.targetPaths?.[0]?.trim() ||
    presentation?.summary?.trim();
  return detail || undefined;
}

export function sessionRunPhaseToActivityKind(phase: SessionRunPhase): RunStatusKind {
  switch (phase) {
    case 'accepted':
    case 'preparing':
      return 'preparing';
    case 'connecting-model':
      return 'connecting-model';
    case 'waiting-first-token':
      return 'waiting-first-token';
    case 'streaming':
    case 'tool-running':
      return 'working';
    case 'waiting-permission':
      return 'waiting-permission';
    case 'waiting-subagents':
      return 'waiting-subagents';
    case 'waiting-resource':
      return 'waiting-resource';
    case 'pausing':
    case 'cancelling':
      return 'stopping';
    default:
      return 'working';
  }
}
