/**
 * Right-panel tabs are instances, not tool kinds.
 *
 * `browser-2` is a second Browser tab beside `browser`. The bare kind
 * (`browser`) is instance 1, so tabs stored before multi-open still restore.
 * Terminal keeps its own ids (`terminal-1`): those name a PTY session.
 */

export const RIGHT_PANEL_TOOL_KINDS = [
  'files',
  'terminal',
  'review',
  'browser',
  'notes',
  'cards',
  'canvas',
  'sideChat',
  'docPreview',
  'tasks',
] as const;

export type RightPanelToolKind = (typeof RIGHT_PANEL_TOOL_KINDS)[number];

const TOOL_KIND_SET = new Set<string>(RIGHT_PANEL_TOOL_KINDS);

export function isRightPanelToolKind(value: string): value is RightPanelToolKind {
  return TOOL_KIND_SET.has(value);
}

/** `browser-2` → browser. A PTY id (`terminal-1`) stays a terminal. */
export function rightPanelTabKind(tab: string): RightPanelToolKind | null {
  if (isRightPanelToolKind(tab)) return tab;
  const dash = tab.indexOf('-');
  if (dash <= 0) return null;
  const kind = tab.slice(0, dash);
  return isRightPanelToolKind(kind) ? kind : null;
}

export function isRightPanelInstanceTab(tab: string, kind: RightPanelToolKind): boolean {
  return rightPanelTabKind(tab) === kind;
}

/**
 * Next tab id for one more instance of `kind`.
 * The first stays the bare kind; later ones are `kind-2`, `kind-3`, …
 */
export function allocateRightPanelInstanceId(
  kind: RightPanelToolKind,
  openTabs: readonly string[],
): string {
  const taken = new Set(
    openTabs.filter((tab) => isRightPanelInstanceTab(tab, kind)),
  );
  if (!taken.has(kind)) return kind;
  let index = 2;
  while (taken.has(`${kind}-${index}`)) index += 1;
  return `${kind}-${index}`;
}

/**
 * Where a newly opened tab lands: directly after the active tab.
 * With nothing active, or an active tab the strip no longer lists, it goes
 * at the end. An id that is already open keeps its place.
 */
export function insertTabAfterActive<T extends string>(
  tabs: readonly T[],
  tab: T,
  active: T | null,
): T[] {
  if (tabs.includes(tab)) return [...tabs];
  const next = [...tabs];
  const anchor = active !== null ? next.indexOf(active) : -1;
  next.splice(anchor >= 0 ? anchor + 1 : next.length, 0, tab);
  return next;
}
