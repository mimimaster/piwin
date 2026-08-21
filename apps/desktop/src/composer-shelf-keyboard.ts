/**
 * Keyboard traversal for composer diversion chips (PRD F6.2).
 * Arrow keys move, Delete/Backspace remove, Space/Enter preview, Escape returns.
 */
import type { KeyboardEvent } from 'react';

export type ShelfChipKeyHandlers = {
  onRemoveAttachment: (localId: string) => void;
  onRemoveContextRef?: ((key: string) => void) | undefined;
  onRemoveDocComments?: (() => void) | undefined;
  onRequestComposerFocus?: (() => void) | undefined;
};

export function nextShelfChipIndex(
  current: number,
  count: number,
  direction: 'prev' | 'next',
): number {
  if (count <= 0) return 0;
  if (direction === 'next') return Math.min(current + 1, count - 1);
  return Math.max(current - 1, 0);
}

export function handleShelfChipsKeyDown(
  event: KeyboardEvent<HTMLDivElement>,
  handlers: ShelfChipKeyHandlers,
): void {
  const chip = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-shelf-chip]');
  if (!chip || !event.currentTarget.contains(chip)) {
    return;
  }
  const chips = [...event.currentTarget.querySelectorAll<HTMLElement>('[data-shelf-chip]')];
  const index = chips.indexOf(chip);
  if (index < 0) {
    return;
  }

  if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
    event.preventDefault();
    chips[nextShelfChipIndex(index, chips.length, 'next')]?.focus();
    return;
  }
  if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
    event.preventDefault();
    chips[nextShelfChipIndex(index, chips.length, 'prev')]?.focus();
    return;
  }
  if (event.key === 'Escape') {
    event.preventDefault();
    handlers.onRequestComposerFocus?.();
    return;
  }
  if (event.key === ' ' || event.key === 'Enter') {
    if ((event.target as HTMLElement | null)?.closest('button')) {
      return;
    }
    const preview = chip.querySelector<HTMLElement>('[data-testid="media-preview-open"]');
    if (preview) {
      event.preventDefault();
      preview.click();
    }
    return;
  }
  if (event.key !== 'Delete' && event.key !== 'Backspace') {
    return;
  }
  if ((event.target as HTMLElement | null)?.closest('button')) {
    return;
  }
  event.preventDefault();
  const kind = chip.dataset.shelfKind;
  const id = chip.dataset.shelfId ?? '';
  const nextChip = chips[index + 1] ?? chips[index - 1];
  const nextKind = nextChip?.dataset.shelfKind;
  const nextId = nextChip?.dataset.shelfId;
  if (kind === 'attachment' && id) {
    handlers.onRemoveAttachment(id);
  } else if (kind === 'context-ref' && id) {
    handlers.onRemoveContextRef?.(id);
  } else if (kind === 'doc-comments') {
    handlers.onRemoveDocComments?.();
  }
  window.setTimeout(() => {
    if (!nextKind) {
      handlers.onRequestComposerFocus?.();
      return;
    }
    const selector =
      nextKind === 'doc-comments'
        ? '[data-shelf-kind="doc-comments"]'
        : `[data-shelf-kind="${nextKind}"][data-shelf-id="${cssAttr(nextId ?? '')}"]`;
    const node = document.querySelector<HTMLElement>(
      `[data-testid="composer-attachment-shelf"] ${selector}`,
    );
    if (node) {
      node.focus();
      return;
    }
    handlers.onRequestComposerFocus?.();
  }, 0);
}

function cssAttr(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}
