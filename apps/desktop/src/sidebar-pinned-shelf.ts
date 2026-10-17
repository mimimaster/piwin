import type { SidebarTreeRow } from './sidebar-tree-rows';

export type SidebarPinnedShelfSplit = {
  /** The pinned header and its rows, rendered above the scroller. */
  shelfRows: SidebarTreeRow[];
  /** Everything else, in builder order — the scrolling (maybe virtual) list. */
  scrollRows: SidebarTreeRow[];
};

/**
 * Lift the pinned section out of the scrolling tree.
 *
 * Pinned sessions are the ones you want reachable when the list is long, which
 * is exactly when the tree virtualizes — and a virtualized row unmounts once
 * scrolled past, so `position: sticky` on it cannot hold. Rendering the
 * section as its own block above the scroller keeps it in view instead.
 *
 * The section runs from its header to the next header, the same boundary
 * `filterSidebarRowsByMode` uses.
 */
export function splitPinnedShelfRows(rows: readonly SidebarTreeRow[]): SidebarPinnedShelfSplit {
  const shelfRows: SidebarTreeRow[] = [];
  const scrollRows: SidebarTreeRow[] = [];
  let inPinned = false;
  for (const row of rows) {
    if (row.kind === 'section-header') {
      inPinned = row.sectionId === 'pinned';
    }
    (inPinned ? shelfRows : scrollRows).push(row);
  }
  return { shelfRows, scrollRows };
}
