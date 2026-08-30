import type { FlashcardStudySnapshot } from '@piwin/contracts';

export type FlashcardStudyPhase =
  | 'loading'
  | 'question'
  | 'answer'
  | 'saving'
  | 'transitioning'
  | 'paused'
  | 'completed'
  | 'disconnected'
  | 'pending-confirmation'
  | 'read-only'
  | 'error';

export type FlashcardStudyViewModel = {
  phase: FlashcardStudyPhase;
  snapshot: FlashcardStudySnapshot | null;
  error: { code: string; message: string } | null;
  transitionId: string | null;
  connected: boolean;
  pendingConfirmation: boolean;
  readOnly: boolean;
};

export type FlashcardStudyControllerState = {
  snapshot: FlashcardStudySnapshot | null;
  error: { code: string; message: string } | null;
  connected: boolean;
  pending: boolean;
  awaitingConfirmation: boolean;
  saving: boolean;
  transitionId: string | null;
  transitionSettled: boolean;
};

export function studyTransitionId(roundId: string, revision: number): string {
  return `${roundId}:${revision}`;
}

export function deriveFlashcardStudyViewModel(
  state: FlashcardStudyControllerState,
): FlashcardStudyViewModel {
  const snapshot = state.snapshot;
  const readOnly = snapshot !== null && !snapshot.access.hasControl;
  const pendingConfirmation = state.pending && (state.awaitingConfirmation || !state.connected);
  const phase = derivePhase(state, snapshot, readOnly, pendingConfirmation);
  return {
    phase,
    snapshot,
    error: state.error,
    transitionId: state.transitionId,
    connected: state.connected,
    pendingConfirmation,
    readOnly,
  };
}

function derivePhase(
  state: FlashcardStudyControllerState,
  snapshot: FlashcardStudySnapshot | null,
  readOnly: boolean,
  pendingConfirmation: boolean,
): FlashcardStudyPhase {
  if (state.error) return 'error';
  if (!state.connected) return pendingConfirmation ? 'pending-confirmation' : 'disconnected';
  if (pendingConfirmation) return 'pending-confirmation';
  if (!snapshot) return 'loading';
  if (readOnly) return 'read-only';
  if (snapshot.round.status === 'paused') return 'paused';
  if (snapshot.round.status === 'completed' || snapshot.round.status === 'ended') {
    return 'completed';
  }
  if (state.transitionId && !state.transitionSettled) return 'transitioning';
  if (state.saving) return 'saving';
  return snapshot.round.face === 'answer' ? 'answer' : 'question';
}
