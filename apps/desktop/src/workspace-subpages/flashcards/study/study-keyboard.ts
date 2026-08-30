import type { FlashcardStudyMode } from '@piwin/contracts';
import type { FlashcardStudyPhase } from '@piwin/host-client';
import type { ReviewRating } from '@piwin/contracts';

export type StudyKeyboardAction =
  | { type: 'flip' }
  | { type: 'next' }
  | { type: 'rate'; rating: ReviewRating }
  | { type: 'leave' }
  | { type: 'close-overlay' };

export type StudyKeyboardTarget = {
  tagName: string;
  isContentEditable: boolean;
};

export type StudyKeyboardEvent = {
  key: string;
  repeat: boolean;
  isComposing: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  target: StudyKeyboardTarget | null;
};

export type StudyKeyboardContext = {
  mode: FlashcardStudyMode;
  phase: FlashcardStudyPhase;
  overlayOpen: boolean;
};

const RATE_KEYS: Record<string, ReviewRating> = {
  '1': 'again',
  '2': 'hard',
  '3': 'good',
  '4': 'easy',
};

const EDITABLE_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

export function isStudyTypingTarget(target: StudyKeyboardTarget | null): boolean {
  if (target === null) return false;
  return EDITABLE_TAGS.has(target.tagName) || target.isContentEditable;
}

function isNativeButtonActivation(event: StudyKeyboardEvent): boolean {
  if (event.target?.tagName !== 'BUTTON') return false;
  return event.key === ' ' || event.key === 'Spacebar' || event.key === 'Enter';
}

function isSpace(key: string): boolean {
  return key === ' ' || key === 'Spacebar';
}

/** Resolve one keydown to a single study action. Repeat / IME / OS shortcuts are ignored. */
export function resolveStudyKeyboard(
  event: StudyKeyboardEvent,
  context: StudyKeyboardContext,
): StudyKeyboardAction | null {
  if (event.repeat || event.isComposing) return null;
  if (event.metaKey || event.ctrlKey || event.altKey) return null;

  if (event.key === 'Escape') {
    return context.overlayOpen ? { type: 'close-overlay' } : { type: 'leave' };
  }

  if (context.overlayOpen) return null;

  if (isStudyTypingTarget(event.target)) return null;
  if (isNativeButtonActivation(event)) return null;

  const interactive =
    context.phase === 'question' || context.phase === 'answer' || context.phase === 'saving';
  if (!interactive && context.phase !== 'paused' && context.phase !== 'completed') {
    return null;
  }

  if (isSpace(event.key)) {
    if (context.phase === 'question' || context.phase === 'answer') return { type: 'flip' };
    return null;
  }

  if (context.mode === 'sequence' && (event.key === 'Enter' || event.key === 'ArrowRight')) {
    if (context.phase === 'question') return { type: 'flip' };
    if (context.phase === 'answer') return { type: 'next' };
    return null;
  }

  if (context.mode === 'scheduled' && context.phase === 'answer') {
    const rating = RATE_KEYS[event.key];
    if (rating) return { type: 'rate', rating };
  }

  return null;
}
