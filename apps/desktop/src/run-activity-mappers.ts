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
  };
}

export function turnPresentationToActivityInput(
  presentation: TurnPresentation,
  message: ChatMessageUi,
  locale: 'zh-CN' | 'en',
  now = Date.now(),
): RunActivityInput {
  const latestPhase = presentation.phaseHistory[presentation.phaseHistory.length - 1]?.phase;
  const kind = latestPhase ? sessionRunPhaseToActivityKind(latestPhase) : 'connecting-model';
  const activeToolName = message.tools.find((tool) => tool.status === 'running')?.toolName;
  // Round to nearest second so `input.elapsedMs` is stable across sub-second `TurnWorkDetails` re-renders.
  const elapsedMs =
    typeof presentation.startedAt === 'number'
      ? Math.floor((Math.max(0, now - presentation.startedAt)) / 1000) * 1000
      : undefined;

  return {
    kind,
    locale,
    ...(activeToolName !== undefined ? { activeToolName } : {}),
    ...(elapsedMs !== undefined ? { elapsedMs } : {}),
  };
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
    case 'cancelling':
      return 'stopping';
    default:
      return 'working';
  }
}
