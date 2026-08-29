/**
 * Pure card-face selection snapshot. DOM Ranges are context; this module
 * only decides whether a live Selection is a valid tutor input.
 */

export const CARD_SELECTION_MIN_CHARS = 1;
export const CARD_SELECTION_MAX_CHARS = 300;

export type CardSelectionSnapshot = {
  selectedText: string;
  range: Range;
};

export function selectionCharCount(text: string): number {
  return Array.from(text).length;
}

export function clipSelectionText(text: string): string {
  const trimmed = text.trim();
  const chars = Array.from(trimmed);
  if (chars.length <= CARD_SELECTION_MAX_CHARS) return trimmed;
  return chars.slice(0, CARD_SELECTION_MAX_CHARS).join('');
}

export function isRangeAttached(range: Range): boolean {
  try {
    return range.commonAncestorContainer.isConnected;
  } catch {
    return false;
  }
}

function nodeIsInside(container: Element, node: Node): boolean {
  return container === node || container.contains(node);
}

export function rangeIsInsideContainer(container: Element, range: Range): boolean {
  if (!isRangeAttached(range)) return false;
  return (
    nodeIsInside(container, range.startContainer) && nodeIsInside(container, range.endContainer)
  );
}

export function snapshotCardTextSelection(
  container: Element,
  selection: Selection | null = typeof window === 'undefined' ? null : window.getSelection(),
): CardSelectionSnapshot | null {
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return null;
  }
  let range: Range;
  try {
    range = selection.getRangeAt(0);
  } catch {
    return null;
  }
  if (!rangeIsInsideContainer(container, range)) {
    return null;
  }
  const selectedText = selection.toString().trim();
  const length = selectionCharCount(selectedText);
  if (length < CARD_SELECTION_MIN_CHARS || length > CARD_SELECTION_MAX_CHARS) {
    return null;
  }
  return { selectedText, range: range.cloneRange() };
}
