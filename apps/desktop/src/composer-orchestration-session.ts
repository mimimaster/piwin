/**
 * Conversation-scoped composer orchestration pill.
 *
 * The pill is not a durable default and not a per-send reset. A live session
 * keeps the scheme the user chose until they change it or start New Agent.
 * Switching away parks that choice and restores it on return. New Agent is
 * freehand. First-send (draft → created session) is the same conversation:
 * the caller must not invoke the parking helper then.
 */
import { ORCHESTRATION_SCHEME_OFF_ID } from '@piwin/contracts';

export type ComposerOrchestrationSessionChange = {
  previousSessionId: string | null;
  nextSessionId: string | null;
  /** Send created the Host session; composer already committed this turn. */
  skipDraftSave: boolean;
  /** Media attach created the Host session under the same New Agent draft. */
  preserveComposerOnSessionActivation: boolean;
};

export type ComposerOrchestrationControls = {
  schemeId: string;
  delegationDisabled: boolean;
};

export function shouldResetComposerOrchestrationOnSessionChange(
  input: ComposerOrchestrationSessionChange,
): boolean {
  if (input.previousSessionId === input.nextSessionId) {
    return false;
  }
  const leavingDraft = input.previousSessionId == null && input.nextSessionId != null;
  if (
    leavingDraft &&
    (input.skipDraftSave || input.preserveComposerOnSessionActivation)
  ) {
    return false;
  }
  return true;
}

export function resolveComposerOrchestrationForSessionChange(input: {
  previousSessionId: string | null;
  nextSessionId: string | null;
  current: ComposerOrchestrationControls;
  parked: ReadonlyMap<string, ComposerOrchestrationControls>;
}): { controls: ComposerOrchestrationControls; parked: Map<string, ComposerOrchestrationControls> } {
  const parked = new Map(input.parked);
  if (input.previousSessionId) {
    if (
      input.current.schemeId === ORCHESTRATION_SCHEME_OFF_ID &&
      input.current.delegationDisabled !== true
    ) {
      parked.delete(input.previousSessionId);
    } else {
      parked.set(input.previousSessionId, input.current);
    }
  }
  const controls = input.nextSessionId
    ? (parked.get(input.nextSessionId) ?? {
        schemeId: ORCHESTRATION_SCHEME_OFF_ID,
        delegationDisabled: false,
      })
    : { schemeId: ORCHESTRATION_SCHEME_OFF_ID, delegationDisabled: false };
  return { controls, parked };
}
