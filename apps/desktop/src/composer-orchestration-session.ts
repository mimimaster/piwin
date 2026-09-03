/**
 * When the composer should drop its in-memory orchestration scheme.
 *
 * The pill is conversation-scoped UI state, not a durable default. Switching
 * conversations (live session A→B, New Agent, or clicking an existing session
 * from a draft) returns to freehand. First-send from New Agent is the same
 * conversation: Host creates the session, and wiping the pill would show
 * Freehand while the turn still runs under the scheme the user just sent.
 */
export type ComposerOrchestrationSessionChange = {
  previousSessionId: string | null;
  nextSessionId: string | null;
  /** Send created the Host session; composer already committed this turn. */
  skipDraftSave: boolean;
  /** Media attach created the Host session under the same New Agent draft. */
  preserveComposerOnSessionActivation: boolean;
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
