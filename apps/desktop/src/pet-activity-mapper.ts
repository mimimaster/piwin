/**
 * Map a PetRuntimeSnapshot (which carries raw activity info from the host)
 * into the RunActivityInput shape that buildActivityPhrases consumes.
 *
 * The host pushes raw fields (toolName, permissionAction, runPhase) without
 * locale; this module is desktop-side and owns the zh-CN / en decision.
 */
import type { PetRuntimeSnapshot, SessionRunPhase } from '@piwin/contracts';
import type { RunActivityInput } from './run-activity-types.js';
import type { RunStatusKind } from './run-status.js';

/** Map SessionRunPhase → RunStatusKind (phase is more precise than animation state). */
function phaseToKind(phase: SessionRunPhase): RunStatusKind {
  switch (phase) {
    case 'preparing':
      return 'preparing';
    case 'connecting-model':
      return 'connecting-model';
    case 'waiting-first-token':
      return 'waiting-first-token';
    case 'streaming':
      return 'waiting-first-token';
    case 'tool-running':
      return 'working';
    case 'waiting-permission':
      return 'waiting-permission';
    case 'waiting-subagents':
      return 'waiting-subagents';
    case 'waiting-resource':
      return 'waiting-resource';
    case 'cancelling':
      return 'stopping';
    default:
      return 'idle';
  }
}

/** Fallback: map PetAnimationState → RunStatusKind when no run phase is available. */
function stateToKind(state: PetRuntimeSnapshot['state']): RunStatusKind {
  switch (state) {
    case 'running':
      return 'working';
    case 'waiting':
      return 'waiting-permission';
    case 'failed':
      return 'failed';
    case 'review':
      return 'complete';
    default:
      return 'idle';
  }
}

/**
 * Returns a RunActivityInput if the pet is doing something worth showing,
 * or `null` when idle (so the caller can hide the bubble entirely).
 */
export function petToActivityInput(
  pet: PetRuntimeSnapshot,
  locale: 'zh-CN' | 'en',
): RunActivityInput | null {
  const activity = pet.activity;
  const kind = activity?.phase ? phaseToKind(activity.phase) : stateToKind(pet.state);

  if (kind === 'idle') return null;

  return {
    kind,
    locale,
    ...(activity?.toolName ? { activeToolName: activity.toolName } : {}),
    ...(activity?.permissionAction ? { actionCategory: 'ask' as const } : {}),
    ...(activity?.detail ? { detail: activity.detail } : {}),
    ...(activity?.actionVerb ? { actionVerb: activity.actionVerb } : {}),
  };
}
