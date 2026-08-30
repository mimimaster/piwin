import { join, resolve, sep } from 'node:path';

export function getFlashcardsRoot(piwinRoot: string): string {
  return join(piwinRoot, 'flashcards');
}

export function getCardsDir(flashcardsRoot: string): string {
  return join(flashcardsRoot, 'cards');
}

export function getReviewDir(flashcardsRoot: string): string {
  return join(flashcardsRoot, 'review');
}

export function getStudyDir(flashcardsRoot: string): string {
  return join(flashcardsRoot, 'study');
}

export function getStudyRoundsDir(flashcardsRoot: string): string {
  return join(getStudyDir(flashcardsRoot), 'rounds');
}

export function getStudyOperationsDir(flashcardsRoot: string): string {
  return join(getStudyDir(flashcardsRoot), 'operations');
}

export const DEFAULT_DECK = 'default';

/** Reject path traversal: target must stay under flashcardsRoot. */
export function assertInsideFlashcardsRoot(
  flashcardsRoot: string,
  absolutePath: string,
): string {
  const root = resolve(flashcardsRoot);
  const target = resolve(absolutePath);
  if (target !== root && !target.startsWith(root + sep)) {
    throw new Error(`path escapes flashcards root: ${absolutePath}`);
  }
  return target;
}

export function sanitizeCardId(value: string): string {
  if (!value || value.includes('..') || value.includes('/') || value.includes('\\')) {
    throw new Error('invalid card id: path traversal rejected');
  }
  if (!/^[a-zA-Z0-9._-]+$/.test(value)) {
    throw new Error('invalid card id: unsafe characters');
  }
  return value;
}
