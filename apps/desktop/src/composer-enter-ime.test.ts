import { describe, expect, it } from 'vitest';
import {
  COMPOSER_IME_ENTER_GUARD_MS,
  decideComposerEnterKey,
  IME_UNSETTLED_KEY_CODE,
} from './composer-enter-ime';

describe('decideComposerEnterKey', () => {
  it('lets the IME handle Enter while composition is active', () => {
    expect(
      decideComposerEnterKey({
        isComposing: true,
        keyCode: 13,
        endedCompositionWithEnter: false,
        msSinceCompositionEnd: 0,
      }),
    ).toBe('let-ime');
  });

  it('treats keyCode 229 as an unsettled IME Enter', () => {
    expect(
      decideComposerEnterKey({
        isComposing: false,
        keyCode: IME_UNSETTLED_KEY_CODE,
        endedCompositionWithEnter: false,
        msSinceCompositionEnd: 0,
      }),
    ).toBe('let-ime');
  });

  it('swallows the leftover Enter after confirming a candidate with Enter', () => {
    expect(
      decideComposerEnterKey({
        isComposing: false,
        keyCode: 13,
        endedCompositionWithEnter: true,
        msSinceCompositionEnd: 0,
      }),
    ).toBe('swallow');
    expect(
      decideComposerEnterKey({
        isComposing: false,
        keyCode: 13,
        endedCompositionWithEnter: true,
        msSinceCompositionEnd: COMPOSER_IME_ENTER_GUARD_MS - 1,
      }),
    ).toBe('swallow');
  });

  it('sends after Space/number confirmation even if composition just ended', () => {
    expect(
      decideComposerEnterKey({
        isComposing: false,
        keyCode: 13,
        endedCompositionWithEnter: false,
        msSinceCompositionEnd: 0,
      }),
    ).toBe('submit');
  });

  it('sends once the leftover-Enter window has passed', () => {
    expect(
      decideComposerEnterKey({
        isComposing: false,
        keyCode: 13,
        endedCompositionWithEnter: true,
        msSinceCompositionEnd: COMPOSER_IME_ENTER_GUARD_MS,
      }),
    ).toBe('submit');
  });
});
