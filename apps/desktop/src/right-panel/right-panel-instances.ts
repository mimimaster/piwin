/**
 * Right-panel tabs are instances, not tool kinds.
 *
 * `browser-2` is a second Browser tab beside `browser`. The bare kind
 * (`browser`) is instance 1, so tabs stored before multi-open still restore.
 * Terminal keeps its own ids (`terminal-1`): those name a PTY session.
 */

export const RIGHT_PANEL_TOOL_KINDS = [
  'summary',
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

/**
 * Which tab an "open this tool" request should select.
 *
 * A request names a kind (`browser`), but the open tabs may hold only an
 * instance (`browser-2`). Creating the bare kind there would allocate a
 * second surface and leave the live page behind — expand on a mini, a rail row,
 * or a tool deep-link must focus what is already open.
 */
export function existingTabForKind<T extends string>(
  requested: T,
  openTabs: readonly T[],
): T | null {
  if (openTabs.includes(requested)) return requested;
  const kind = rightPanelTabKind(requested);
  if (kind === null) return null;
  const instances = openTabs.filter((tab: T) => isRightPanelInstanceTab(tab, kind));
  if (instances.length === 0) return null;
  // Prefer the primary tab, then the lowest instance index (`browser-2` before
  // `browser-10`, unlike a string sort).
  return instances.sort((left, right) => instanceRank(left) - instanceRank(right))[0] ?? null;
}

function instanceRank(tab: string): number {
  const dash = tab.indexOf('-');
  if (dash < 0) return 1;
  const index = Number.parseInt(tab.slice(dash + 1), 10);
  return Number.isFinite(index) ? index : Number.MAX_SAFE_INTEGER;
}
