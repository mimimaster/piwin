/**
 * Read, snapshot and restore the live selection, including one inside an
 * open shadow tree.
 *
 * Radix ContextMenu clears `window.getSelection()` on open even when
 * modal=false (Chromium), so the highlight has to be put back. WebKit's
 * `getRangeAt` re-scopes a selection inside a shadow tree to the shadow host,
 * so a snapshot taken through it is not the reader's selection: restoring it
 * wipes the highlight. Callers that know the shadow roots in play pass them
 * and the boundaries come from `getComposedRanges` instead.
 */
export type SelectionBoundary = {
  readonly startContainer: Node;
  readonly startOffset: number;
  readonly endContainer: Node;
  readonly endOffset: number;
};

/** Safari 17.0–17.3 shipped the variadic signature before the options bag. */
type VariadicComposedRanges = (...shadowRoots: ShadowRoot[]) => StaticRange[];

function defaultSelection(): Selection | null {
  return typeof window === 'undefined' ? null : window.getSelection();
}

function readComposedBoundaries(
  selection: Selection,
  shadowRoots: readonly ShadowRoot[],
): SelectionBoundary[] | null {
  if (shadowRoots.length === 0 || typeof selection.getComposedRanges !== 'function') {
    return null;
  }
  try {
    return selection.getComposedRanges({ shadowRoots: [...shadowRoots] });
  } catch (error) {
    if (!(error instanceof TypeError)) {
      throw error;
    }
    // The variadic form rejects the options bag with a TypeError.
    const variadic = selection.getComposedRanges as unknown as VariadicComposedRanges;
    return variadic.call(selection, ...shadowRoots);
  }
}

/** Every open shadow root an event passed through, innermost first. */
export function shadowRootsInEventPath(event: Event): ShadowRoot[] {
  if (typeof event.composedPath !== 'function') {
    return [];
  }
  return event
    .composedPath()
    .filter((node): node is ShadowRoot => typeof ShadowRoot !== 'undefined' && node instanceof ShadowRoot);
}

/**
 * Boundaries of the current selection. With `shadowRoots`, a selection inside
 * those trees reads as itself rather than as WebKit's host-level stand-in.
 */
export function readSelectionBoundaries(
  selection: Selection | null = defaultSelection(),
  shadowRoots: readonly ShadowRoot[] = [],
): SelectionBoundary[] {
  if (!selection) {
    return [];
  }
  const composed = readComposedBoundaries(selection, shadowRoots);
  if (composed) {
    return composed;
  }
  const ranges: SelectionBoundary[] = [];
  for (let index = 0; index < selection.rangeCount; index += 1) {
    ranges.push(selection.getRangeAt(index).cloneRange());
  }
  return ranges;
}

export function isCollapsedBoundary(boundary: SelectionBoundary): boolean {
  return (
    boundary.startContainer === boundary.endContainer &&
    boundary.startOffset === boundary.endOffset
  );
}

/**
 * A live Range for a boundary, or null when its ends sit in different trees
 * (a Range cannot span a shadow boundary; it would silently collapse).
 */
export function rangeFromSelectionBoundary(boundary: SelectionBoundary): Range | null {
  if (typeof Range !== 'undefined' && boundary instanceof Range) {
    return boundary;
  }
  if (boundary.startContainer.getRootNode() !== boundary.endContainer.getRootNode()) {
    return null;
  }
  const owner = boundary.startContainer.ownerDocument ?? document;
  const range = owner.createRange();
  range.setStart(boundary.startContainer, boundary.startOffset);
  range.setEnd(boundary.endContainer, boundary.endOffset);
  return range;
}

/**
 * Live ranges for the current selection. Composed boundaries that cross a
 * shadow boundary fall back to the selection's own `getRangeAt`.
 */
export function readSelectionRanges(
  selection: Selection | null = defaultSelection(),
  shadowRoots: readonly ShadowRoot[] = [],
): Range[] {
  if (!selection) {
    return [];
  }
  return readSelectionBoundaries(selection, shadowRoots).flatMap((boundary, index) => {
    const range = rangeFromSelectionBoundary(boundary);
    if (range) {
      return [range];
    }
    return index < selection.rangeCount ? [selection.getRangeAt(index).cloneRange()] : [];
  });
}

export function snapshotSelectionRanges(
  selection: Selection | null = defaultSelection(),
  shadowRoots: readonly ShadowRoot[] = [],
): SelectionBoundary[] {
  return readSelectionBoundaries(selection, shadowRoots).map((boundary) => ({
    startContainer: boundary.startContainer,
    startOffset: boundary.startOffset,
    endContainer: boundary.endContainer,
    endOffset: boundary.endOffset,
  }));
}

function sameBoundaries(
  left: readonly SelectionBoundary[],
  right: readonly SelectionBoundary[],
): boolean {
  return (
    left.length === right.length &&
    left.every((boundary, index) => {
      const other = right[index];
      return (
        other !== undefined &&
        boundary.startContainer === other.startContainer &&
        boundary.startOffset === other.startOffset &&
        boundary.endContainer === other.endContainer &&
        boundary.endOffset === other.endOffset
      );
    })
  );
}

/**
 * Put a snapshot back. A selection that is still intact is left untouched, so
 * restoring never replaces the reader's highlight with a re-scoped copy.
 */
export function restoreSelectionRanges(
  saved: readonly SelectionBoundary[],
  selection: Selection | null = defaultSelection(),
  shadowRoots: readonly ShadowRoot[] = [],
): boolean {
  if (!selection || saved.length === 0) {
    return false;
  }
  if (sameBoundaries(readSelectionBoundaries(selection, shadowRoots), saved)) {
    return true;
  }
  const [only] = saved;
  if (saved.length === 1 && only && typeof selection.setBaseAndExtent === 'function') {
    try {
      // Unlike addRange, accepts boundaries inside (or across) shadow trees.
      selection.setBaseAndExtent(
        only.startContainer,
        only.startOffset,
        only.endContainer,
        only.endOffset,
      );
      return true;
    } catch {
      // A node was detached after the menu portal mounted; nothing to restore.
      return false;
    }
  }
  if (typeof selection.removeAllRanges === 'function') {
    selection.removeAllRanges();
  }
  let restored = false;
  for (const boundary of saved) {
    try {
      const range = rangeFromSelectionBoundary(boundary);
      if (range && typeof selection.addRange === 'function') {
        selection.addRange(range);
        restored = true;
      }
    } catch {
      // Range detached after the menu portal mounted.
    }
  }
  return restored;
}
