import { describe, expect, it } from 'vitest';
import { looksLikeControlledAbortErrorMessage } from './controlled-abort-error.js';

describe('looksLikeControlledAbortErrorMessage', () => {
  it('matches the toast text from the pause regression', () => {
    expect(looksLikeControlledAbortErrorMessage('The operation was aborted')).toBe(true);
  });

  it('rejects ordinary model failures', () => {
    expect(looksLikeControlledAbortErrorMessage('model-unavailable: cannot switch model')).toBe(
      false,
    );
  });
});
