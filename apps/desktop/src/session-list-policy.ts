/** Desktop request bound for one `session/list` hydration. Not a Host-wide cap. */
export const DESKTOP_SESSION_LIST_MAX_ITEMS = 2000;

/** Virtualize the flattened sidebar when the row count exceeds this value. */
export const SIDEBAR_VIRTUALIZATION_MIN_ROWS = 60;

export function shouldVirtualizeSidebar(rowCount: number): boolean {
  return rowCount > SIDEBAR_VIRTUALIZATION_MIN_ROWS;
}
