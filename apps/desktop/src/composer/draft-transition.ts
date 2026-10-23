/**
 * Draft ↔ live-session transition decisions for the composer.
 *
 * Draft mode (activeSessionId === null) keeps typed text across session
 * switches. When the draft becomes a live session the effect must decide
 * whether the composer text was sent (clear — handleSend already cleared it),
 * belongs to an in-flight media attach (keep — pasting an image must not wipe
 * the typed prompt), or the user switched to another session (save + clear).
 */
export type DraftTransitionInput = {
  leavingDraft: boolean;
  enteringDraft: boolean;
  /** Send created the session; composer was already cleared before activation. */
  skipDraftSave: boolean;
  /** Media paste/drop/picker created the session under the same draft. */
  preserveComposerOnSessionActivation: boolean;
};

export type DraftTransitionDecision =
  | { kind: 'noop' }
  | { kind: 'skip-draft-save' }
  | { kind: 'preserve-composer' }
  | { kind: 'save-and-clear-composer' }
  | { kind: 'restore-draft' };

export function decideDraftTransition(input: DraftTransitionInput): DraftTransitionDecision {
  if (!input.leavingDraft && !input.enteringDraft) {
    return { kind: 'noop' };
  }
  if (input.leavingDraft) {
    if (input.skipDraftSave) {
      return { kind: 'skip-draft-save' };
    }
    if (input.preserveComposerOnSessionActivation) {
      return { kind: 'preserve-composer' };
    }
    return { kind: 'save-and-clear-composer' };
  }
  return { kind: 'restore-draft' };
}
