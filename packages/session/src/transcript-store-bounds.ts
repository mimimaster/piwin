/**
 * Split from transcript-store.ts — pure relocation, no behavior change.
 */

export const MAX_CURSOR_CHARS = 512;
export const CURSOR_ALPHABET = /^[A-Za-z0-9_-]+$/;

export function validatePositiveBoundedInteger(value: number, label: string, maximum: number): void {
  if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) {
    throw new RangeError(`${label} must be between 1 and ${maximum}`);
  }
}

export function isIndexedUserMessage(role: string, text: string): boolean {
  return role === 'user' && text.trim().length > 0;
}
