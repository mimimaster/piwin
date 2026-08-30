import {
  hostSupportsFlashcardStudy,
  isFlashcardStudyId,
  type FlashcardDisplayPayload,
  type FlashcardStudyScope,
  type FlashcardStudySnapshot,
  type HostCommand,
  type HostResponse,
} from '@piwin/contracts';
import { createIdempotencyKey, type HostRequestOptions } from '@piwin/host-client';
import {
  navigateMobileFlashcardsRoute,
} from '../../mobile-flashcards-route.js';
import { stripHostAbsolutePaths } from './catalog-paths.js';
import {
  captureMobileStudyReturnContext,
  saveMobileStudyReturnContext,
} from './study-return-context.js';
import { MOBILE_FLASHCARD_STUDY_COPY } from './study-copy.js';

export type ChatStudyRequest = (
  command: HostCommand,
  options?: HostRequestOptions,
) => Promise<HostResponse>;

export function flashcardStudyScopeFromDisplay(
  payload: FlashcardDisplayPayload,
): FlashcardStudyScope | null {
  const card = payload.cards[0];
  if (!card) return null;
  if (card.sequenceId && isFlashcardStudyId(card.sequenceId)) {
    return { kind: 'sequence', sequenceId: card.sequenceId };
  }
  if (isFlashcardStudyId(card.itemId)) {
    return { kind: 'item', itemId: card.itemId };
  }
  return null;
}

export type StartStudyResult =
  | { ok: true; roundId: string }
  | { ok: false; error: string; code: string };

export async function startValidatedStudyRound(input: {
  request: ChatStudyRequest;
  scope: FlashcardStudyScope;
  mode?: 'sequence' | 'scheduled';
  resumeExisting?: boolean;
  hasStudyCapability: () => boolean;
}): Promise<StartStudyResult> {
  if (!input.hasStudyCapability()) {
    return {
      ok: false,
      error: MOBILE_FLASHCARD_STUDY_COPY.hostTooOld,
      code: 'host-too-old',
    };
  }
  const response = await input.request(
    {
      type: 'flashcards/study/start',
      mode: input.mode ?? 'sequence',
      scope: input.scope,
      resumeExisting: input.resumeExisting !== false,
    },
    { idempotencyKey: createIdempotencyKey() },
  );
  if (!response.success) {
    return {
      ok: false,
      error: response.error || MOBILE_FLASHCARD_STUDY_COPY.roundMissing,
      code: response.problem?.code ?? 'study-error',
    };
  }
  const snapshot = stripHostAbsolutePaths(response.data) as FlashcardStudySnapshot;
  const roundId = snapshot.round?.roundId;
  if (typeof roundId !== 'string' || !isFlashcardStudyId(roundId)) {
    return { ok: false, error: MOBILE_FLASHCARD_STUDY_COPY.roundMissing, code: 'invalid-snapshot' };
  }
  return { ok: true, roundId };
}

export async function enterStudyFromChatDisplay(input: {
  request: ChatStudyRequest;
  payload: FlashcardDisplayPayload;
  hasStudyCapability: () => boolean;
}): Promise<StartStudyResult> {
  const scope = flashcardStudyScopeFromDisplay(input.payload);
  if (!scope) {
    return { ok: false, error: MOBILE_FLASHCARD_STUDY_COPY.roundMissing, code: 'invalid-item' };
  }
  const started = await startValidatedStudyRound({
    request: input.request,
    scope,
    mode: 'sequence',
    resumeExisting: true,
    hasStudyCapability: input.hasStudyCapability,
  });
  if (!started.ok) return started;
  saveMobileStudyReturnContext(
    captureMobileStudyReturnContext({
      source: 'chat',
      selectedDeck: 'all',
      search: '',
      scrollTop: 0,
      focusTileId: null,
    }),
  );
  navigateMobileFlashcardsRoute({ kind: 'study', roundId: started.roundId }, 'push');
  return started;
}

export { hostSupportsFlashcardStudy };
