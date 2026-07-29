import { describe, expect, it } from 'vitest';
import { isFlashcardArtifactSource } from './flashcard-artifact';

describe('isFlashcardArtifactSource', () => {
  it('returns true for source containing data-card-id', () => {
    const source = `<div class="piwin-flashcard" data-card-id="card-abc12345-xyz"></div>`;
    expect(isFlashcardArtifactSource(source)).toBe(true);
  });

  it('returns false for plain html without data-card-id', () => {
    const source = `<div><h1>Hello</h1></div>`;
    expect(isFlashcardArtifactSource(source)).toBe(false);
  });

  it('returns false for empty source', () => {
    expect(isFlashcardArtifactSource('')).toBe(false);
  });

  it('returns true even when data-card-id is inside an HTML comment', () => {
    // The helper is a hint-only affordance; action validation in ArtifactFrame
    // is the real security boundary (design §6, §11). A commented id grants
    // only the Preview card button, no privilege.
    const source = `<!-- data-card-id="fake" --><div></div>`;
    expect(isFlashcardArtifactSource(source)).toBe(true);
  });

  it('returns false for data-card-id without quotes', () => {
    const source = `<div data-card-id=card-1></div>`;
    expect(isFlashcardArtifactSource(source)).toBe(false);
  });

  it('returns true for single-quoted data-card-id', () => {
    const source = `<div data-card-id='card-1'></div>`;
    expect(isFlashcardArtifactSource(source)).toBe(true);
  });
});
