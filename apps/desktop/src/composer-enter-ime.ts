/**
 * Enter vs IME in a textarea that treats plain Enter as send.
 *
 * Confirming a candidate with Enter can fire a leftover keydown after
 * compositionend. That event must not send, and it must not insert a newline.
 * Confirming with Space/number is different: the following Enter is a real
 * send and must go through even if composition just ended.
 */

/** Chrome/Safari report this keyCode while the IME is still unsettled. */
export const IME_UNSETTLED_KEY_CODE = 229;

/** Ghost Enter after IME-Enter-confirm usually arrives in this window. */
export const COMPOSER_IME_ENTER_GUARD_MS = 100;

export type ComposerEnterKeyDecision = 'let-ime' | 'swallow' | 'submit';

export function decideComposerEnterKey(input: {
  isComposing: boolean;
  keyCode: number;
  endedCompositionWithEnter: boolean;
  msSinceCompositionEnd: number;
}): ComposerEnterKeyDecision {
  if (input.isComposing || input.keyCode === IME_UNSETTLED_KEY_CODE) {
    return 'let-ime';
  }
  if (
    input.endedCompositionWithEnter &&
    input.msSinceCompositionEnd < COMPOSER_IME_ENTER_GUARD_MS
  ) {
    return 'swallow';
  }
  return 'submit';
}
