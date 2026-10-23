/**
 * Which commentable block a selection belongs to. The Markdown view stamps every
 * comment target with `data-line-id`; a selection comment reuses that id so the
 * block lights up and its existing popover edits or deletes the comment.
 */

function startElement(range: Range): Element | null {
  const { startContainer, startOffset } = range;
  if (startContainer instanceof Element) {
    // A drag that starts in a gap between blocks lands on the container itself.
    const child = startContainer.childNodes[startOffset];
    if (child instanceof Element) return child;
    if (child?.parentElement) return child.parentElement;
    return startContainer;
  }
  return startContainer.parentElement;
}

export function lineIdForSelectionRange(range: Range): string | null {
  const anchor = startElement(range)?.closest('[data-line-id]');
  return anchor?.getAttribute('data-line-id') ?? null;
}

/** One-line quote for the comment record; the prompt formatter quotes a single line. */
export function selectionQuoteForComment(markdown: string): string {
  return markdown.replace(/\s+/g, ' ').trim();
}
