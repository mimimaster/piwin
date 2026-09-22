/**
 * Persist right-panel multi-tab state across collapses (sessionStorage).
 *
 * A tab is an instance id: `browser` (the first) or `browser-2` (another).
 * Terminal session ids (`terminal-1`) are instances too.
 */

import {
  RIGHT_PANEL_TOOL_KINDS,
  rightPanelTabKind,
  type RightPanelToolKind,
} from './right-panel-instances';

export type RightPanelTabKind =
  | RightPanelToolKind
  | `${RightPanelToolKind}-${string}`;

export type StoredRightPanelState = {
  openTabs: RightPanelTabKind[];
  activeTab: RightPanelTabKind | null;
};

export const RIGHT_PANEL_STATE_STORAGE_KEY = 'piwin.desktop.rightPanelTabs.v1';

/** @deprecated legacy key — read once for migration */
export const RIGHT_PANEL_VIEW_STORAGE_KEY = 'piwin.desktop.rightPanelView';

export { RIGHT_PANEL_TOOL_KINDS };

function isStoredTab(value: unknown): value is RightPanelTabKind {
  return typeof value === 'string' && rightPanelTabKind(value) !== null;
}

export function readStoredRightPanelState(
  storage: Pick<Storage, 'getItem'> | null | undefined = defaultStorage(),
): StoredRightPanelState {
  if (!storage) {
    return { openTabs: [], activeTab: null };
  }
  try {
    const raw = storage.getItem(RIGHT_PANEL_STATE_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { openTabs?: unknown; activeTab?: unknown };
      const openTabs = Array.isArray(parsed.openTabs) ? parsed.openTabs.filter(isStoredTab) : [];
      const activeTab =
        isStoredTab(parsed.activeTab) && openTabs.includes(parsed.activeTab)
          ? parsed.activeTab
          : (openTabs[0] ?? null);
      return { openTabs, activeTab };
    }
    // Migrate legacy home/detail: both go to empty home (user picks a tile).
  } catch {
    /* ignore */
  }
  return { openTabs: [], activeTab: null };
}

export function writeStoredRightPanelState(
  state: StoredRightPanelState,
  storage: Pick<Storage, 'setItem'> | null | undefined = defaultStorage(),
): void {
  if (!storage) {
    return;
  }
  try {
    storage.setItem(RIGHT_PANEL_STATE_STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* ignore */
  }
}

/** Legacy API kept for older tests — maps to multi-tab empty vs has tabs. */
export type StoredRightPanelView = 'home' | 'detail';

export function readStoredRightPanelView(
  storage: Pick<Storage, 'getItem'> | null | undefined = defaultStorage(),
): StoredRightPanelView {
  const state = readStoredRightPanelState(storage);
  return state.openTabs.length > 0 ? 'detail' : 'home';
}

export function writeStoredRightPanelView(
  view: StoredRightPanelView,
  storage: Pick<Storage, 'setItem' | 'getItem'> | null | undefined = defaultStorage(),
): void {
  if (view === 'home') {
    writeStoredRightPanelState({ openTabs: [], activeTab: null }, storage);
    return;
  }
  const current = readStoredRightPanelState(storage);
  if (current.openTabs.length === 0) {
    writeStoredRightPanelState({ openTabs: ['terminal'], activeTab: 'terminal' }, storage);
  }
}

function defaultStorage(): Pick<Storage, 'getItem' | 'setItem'> | null {
  if (typeof sessionStorage === 'undefined') {
    return null;
  }
  return sessionStorage;
}
