/**
 * The user prompt that owns what the reader is looking at, once its bubble has
 * scrolled above the viewport (after Cursor's frozen prompt).
 *
 * Located through the DOM like the fold rail: a turn (prompt + reply) is one
 * virtualized row, so the turn under the viewport top is always mounted and
 * its prompt article with it — however far above that article sits.
 */
import type { ChatMessageUi } from '../conversation/chat-ui-types';
import { transcriptVisibleTop } from '../conversation/transcript-visible-top';

/** Text kept on the prompt article; the pin shows one line of it. */
export const USER_PROMPT_PIN_MAX_CHARS = 240;

export type PinnedUserPrompt = {
  /** The `.chat-turn-user` article the pin jumps back to. */
  article: HTMLElement;
  text: string;
};

/** One line for the pin: the turn's first non-empty prompt, whitespace collapsed. */
export function userPromptPinText(userMessages: readonly ChatMessageUi[]): string {
  for (const message of userMessages) {
    const line = message.text.replace(/\s+/g, ' ').trim();
    if (line.length > 0) return line.slice(0, USER_PROMPT_PIN_MAX_CHARS);
  }
  return '';
}

/**
 * The prompt whose turn spans the viewport top while the prompt itself is
 * fully above it. Its reply must still fill more than the pin row below the
 * top, or the pin would cover the turn's last line and flicker at the seam.
 */
export function pinnedUserPrompt(container: HTMLElement, rowPx: number): PinnedUserPrompt | null {
  const top = transcriptVisibleTop(container);
  for (const article of container.querySelectorAll<HTMLElement>('.chat-turn-user[data-user-prompt]')) {
    const text = article.dataset.userPrompt ?? '';
    const group = article.closest<HTMLElement>('.chat-turn-group');
    if (text.length === 0 || !group) continue;
    if (article.getBoundingClientRect().bottom > top + 1) continue;
    if (group.getBoundingClientRect().bottom > top + rowPx * 1.5) return { article, text };
  }
  return null;
}

/** Bring the prompt back to the top of the viewport. */
export function scrollToPinnedPrompt(
  container: HTMLElement,
  article: HTMLElement,
  beginProgrammaticScroll?: () => void,
): void {
  const delta = article.getBoundingClientRect().top - transcriptVisibleTop(container);
  beginProgrammaticScroll?.();
  container.scrollTop += delta;
}
