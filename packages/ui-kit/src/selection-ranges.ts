/**
 * Snapshot / restore live ranges. Radix ContextMenu clears `window.getSelection()`
 * on open even when modal=false; the highlight has to be put back.
 */
export function snapshotSelectionRanges(
  selection: Selection | null = typeof window === 'undefined' ? null : window.getSelection(),
): Range[] {
  if (!selection || selection.rangeCount === 0) {
    return [];
  }
  const ranges: Range[] = [];
  for (let index = 0; index < selection.rangeCount; index += 1) {
    ranges.push(selection.getRangeAt(index).cloneRange());
  }
  return ranges;
}

export function restoreSelectionRanges(
  ranges: readonly Range[],
  selection: Selection | null = typeof window === 'undefined' ? null : window.getSelection(),
): boolean {
  if (!selection || ranges.length === 0) {
    return false;
  }
  if (typeof selection.removeAllRanges === 'function') {
    selection.removeAllRanges();
  }
  let restored = false;
  for (const range of ranges) {
    try {
      if (typeof selection.addRange === 'function') {
        selection.addRange(range);
        restored = true;
      }
    } catch {
      // Range detached after the menu portal mounted.
    }
  }
  return restored;
}
