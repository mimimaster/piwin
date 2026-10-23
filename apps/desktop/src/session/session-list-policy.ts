/** Desktop request bound for one local `session/list` hydration. Not a Host-wide cap. */
export const DESKTOP_SESSION_LIST_MAX_ITEMS = 2000;

/** Remote sidebar lists match Host hello hydration. 2000 × N projects is a Web Content spike. */
export const DESKTOP_REMOTE_SESSION_LIST_MAX_ITEMS = 200;

export function desktopSessionListMaxItems(transport: string): number {
  return transport === 'remote'
    ? DESKTOP_REMOTE_SESSION_LIST_MAX_ITEMS
    : DESKTOP_SESSION_LIST_MAX_ITEMS;
}

/** Virtualize the flattened sidebar when the row count exceeds this value. */
export const SIDEBAR_VIRTUALIZATION_MIN_ROWS = 60;

export function shouldVirtualizeSidebar(rowCount: number): boolean {
  return rowCount > SIDEBAR_VIRTUALIZATION_MIN_ROWS;
}
