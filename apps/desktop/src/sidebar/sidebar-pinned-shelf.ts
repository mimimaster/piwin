import type { SidebarTreeRow } from './sidebar-tree-rows';

export type SidebarPinnedShelfSplit = {
  /** The pinned header and its rows, rendered above the scroller. */
  shelfRows: SidebarTreeRow[];
  /** The pane's own section header (Conversations / Projects), pinned above the scroller. */
  paneHeaderRow: SidebarTreeRow | null;
  /** Everything else, in builder order — the scrolling (maybe virtual) list. */
  scrollRows: SidebarTreeRow[];
};

/**
 * Lift the pinned section and the pane's leading section header out of the scrolling tree.
 *
 * Pinned sessions are the ones you want reachable when the list is long, which
 * is exactly when the tree virtualizes — and a virtualized row unmounts once
 * scrolled past, so `position: sticky` on it cannot hold. Lifting the pane's
 * leading section header (`Conversations` / `Projects`) for the same reason keeps
 * its count, filter menu, and `+` button pinned while the list below scrolls and
 * keeps the scrollbar and top edge-fade scoped to the scrolling rows.
 *
 * The pinned section runs from its header to the next header, the same boundary
 * `filterSidebarRowsByMode` uses.
 */
export function splitPinnedShelfRows(rows: readonly SidebarTreeRow[]): SidebarPinnedShelfSplit {
  const shelfRows: SidebarTreeRow[] = [];
  const scrollRows: SidebarTreeRow[] = [];
  let paneHeaderRow: SidebarTreeRow | null = null;
  let inPinned = false;
  for (const row of rows) {
    if (row.kind === 'section-header') {
      inPinned = row.sectionId === 'pinned';
      if (inPinned) {
        shelfRows.push(row);
        continue;
      }
      if (paneHeaderRow === null && scrollRows.length === 0) {
        paneHeaderRow = row;
        continue;
      }
    }
    (inPinned ? shelfRows : scrollRows).push(row);
  }
  return { shelfRows, paneHeaderRow, scrollRows };
}
