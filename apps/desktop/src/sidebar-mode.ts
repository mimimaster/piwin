import type { SidebarTreeRow } from './sidebar-tree-rows';

/**
 * Which half of the sidebar is showing.
 *
 * `chat` is the default: conversations you start without a workspace. `code`
 * is the workspace half — projects, their worktrees, and the sessions hanging
 * off each one. They hold different shapes (a flat list of cards vs. a tree of
 * threads), which is why they are two panes rather than two sections of one
 * scroller. See docs/design/inkstone/proto-09-sidebar.html.
 */
export type SidebarMode = 'chat' | 'code';

export const SIDEBAR_MODE_STORAGE_KEY = 'piwin.desktop.sidebar-mode';

export function isSidebarMode(value: unknown): value is SidebarMode {
  return value === 'chat' || value === 'code';
}

/** Reads the remembered mode. Never throws — private-mode storage can reject. */
export function loadSidebarMode(storage?: Pick<Storage, 'getItem'>): SidebarMode {
  try {
    const store = storage ?? (typeof localStorage === 'undefined' ? undefined : localStorage);
    const raw = store?.getItem(SIDEBAR_MODE_STORAGE_KEY);
    return isSidebarMode(raw) ? raw : 'chat';
  } catch {
    return 'chat';
  }
}

export function saveSidebarMode(mode: SidebarMode, storage?: Pick<Storage, 'setItem'>): void {
  try {
    const store = storage ?? (typeof localStorage === 'undefined' ? undefined : localStorage);
    store?.setItem(SIDEBAR_MODE_STORAGE_KEY, mode);
  } catch {
    // Remembering the pane is a convenience; a storage refusal is not an error.
  }
}

/** The mode a session row belongs to, by its scope. */
function rowMode(row: Extract<SidebarTreeRow, { kind: 'session' }>): SidebarMode {
  return row.scope.kind === 'project' ? 'code' : 'chat';
}

/**
 * Split the flat row list into one pane.
 *
 * `buildSidebarTreeRows` emits every section in one array — pinned, then
 * projects, then conversations. Filtering here rather than in the builder
 * keeps the builder (and its tests) untouched: the panes are a presentation
 * split, not a different query.
 *
 * Pinned is the one section both panes carry, because both halves can be
 * pinned — a pinned conversation stays in `chat`, a pinned project session in
 * `code`. Its header is dropped when nothing in it belongs to this pane, so an
 * empty "PINNED" heading never sits above a list it does not describe.
 */
export function filterSidebarRowsByMode(
  rows: readonly SidebarTreeRow[],
  mode: SidebarMode,
): SidebarTreeRow[] {
  const kept: SidebarTreeRow[] = [];
  let section: 'pinned' | 'projects' | 'conversations' | null = null;
  // Index of the pinned header we have provisionally kept, so it can be
  // dropped again if the section turns out to be empty for this pane.
  let pinnedHeaderAt: number | null = null;
  let pinnedBodyCount = 0;

  const closePinned = () => {
    if (pinnedHeaderAt !== null && pinnedBodyCount === 0) {
      kept.splice(pinnedHeaderAt, 1);
    }
    pinnedHeaderAt = null;
    pinnedBodyCount = 0;
  };

  for (const row of rows) {
    if (row.kind === 'section-header') {
      closePinned();
      section = row.sectionId;
      if (section === 'pinned') {
        pinnedHeaderAt = kept.length;
        kept.push(row);
      } else if ((section === 'projects') === (mode === 'code')) {
        kept.push(row);
      }
      continue;
    }

    if (section === 'pinned') {
      if (row.kind === 'session' && rowMode(row) === mode) {
        kept.push(row);
        pinnedBodyCount += 1;
      }
      continue;
    }

    if (section === null) {
      // Emitted before any header — belongs to the sidebar, not to a pane.
      kept.push(row);
      continue;
    }

    // Everything else belongs to whichever section last opened.
    const sectionMode: SidebarMode = section === 'projects' ? 'code' : 'chat';
    if (sectionMode === mode) {
      kept.push(row);
    }
  }

  closePinned();
  return kept;
}
