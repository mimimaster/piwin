import type { FlashcardStudySnapshot } from './flashcard-study.js';

export type FlashcardStudyChangedReason =
  | 'start'
  | 'checkpoint'
  | 'next'
  | 'rate'
  | 'undo'
  | 'claim'
  | 'pause'
  | 'resume'
  | 'end'
  | 'content-changed'
  | 'reconcile';

/** Recoverable study push. Global fans get ids/revision/reason; snapshot is optional. */
export type FlashcardStudyChangedPush = {
  type: 'flashcards/study/changed';
  roundId: string;
  revision: number;
  reason: FlashcardStudyChangedReason;
  snapshot?: FlashcardStudySnapshot;
};
