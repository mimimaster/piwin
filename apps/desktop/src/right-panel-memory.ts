/**
 * Quiet workbench: remember last right-panel inner view across collapses.
 * sessionStorage so reopen restores home vs detail without host/reducer changes.
 */

export type StoredRightPanelView = 'home' | 'detail';

export const RIGHT_PANEL_VIEW_STORAGE_KEY = 'piwin.desktop.rightPanelView';

export function readStoredRightPanelView(
  storage: Pick<Storage, 'getItem'> | null | undefined = defaultStorage(),
): StoredRightPanelView {
  if (!storage) {
    return 'home';
  }
  try {
    const raw = storage.getItem(RIGHT_PANEL_VIEW_STORAGE_KEY);
    return raw === 'detail' ? 'detail' : 'home';
  } catch {
    return 'home';
  }
}

export function writeStoredRightPanelView(
  view: StoredRightPanelView,
  storage: Pick<Storage, 'setItem'> | null | undefined = defaultStorage(),
): void {
  if (!storage) {
    return;
  }
  try {
    storage.setItem(RIGHT_PANEL_VIEW_STORAGE_KEY, view);
  } catch {
    // Private mode / quota — ignore; in-memory state still works for the session.
  }
}

function defaultStorage(): Pick<Storage, 'getItem' | 'setItem'> | null {
  if (typeof sessionStorage === 'undefined') {
    return null;
  }
  return sessionStorage;
}
