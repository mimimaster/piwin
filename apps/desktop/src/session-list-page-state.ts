import type { SessionListPageInfo, SessionScope } from '@piwin/contracts';

export const SESSION_LIST_WINDOW_MAX_PAGES = 3;
export const SESSION_LIST_WINDOW_MAX_BYTES = 128 * 1024;

export type SessionListPageMergeMode = 'replace' | 'append' | 'prepend';

export type SessionListWindowPage<T extends { id: string }> = {
  page: SessionListPageInfo;
  items: T[];
  retainedBytes: number;
};

/** A small adjacent Host-page window. It is never an append-only history. */
export type SessionListWindow<T extends { id: string }> = {
  pages: SessionListWindowPage<T>[];
};

export type SessionListWindowsState<T extends { id: string }> = {
  general: SessionListWindow<T> | null;
  projects: Record<string, SessionListWindow<T>>;
};

export type SessionListWindowBounds = {
  firstPageIndex: number;
  lastPageIndex: number;
  pageCount: number;
  totalCount: number;
  retainedBytes: number;
  previousCursor?: string;
  nextCursor?: string;
};

export function createSessionListWindowsState<
  T extends { id: string },
>(): SessionListWindowsState<T> {
  return { general: null, projects: {} };
}

export { sessionScopeKey } from './session-scope-key';

export function getSessionListWindow<T extends { id: string }>(
  state: SessionListWindowsState<T>,
  scope: SessionScope,
): SessionListWindow<T> | null {
  return scope.kind === 'general' ? state.general : (state.projects[scope.projectPath] ?? null);
}

function measureRetainedBytes(value: unknown): number {
  const serialized = JSON.stringify(value) ?? '';
  return new TextEncoder().encode(serialized).byteLength;
}

function setSessionListWindow<T extends { id: string }>(
  state: SessionListWindowsState<T>,
  scope: SessionScope,
  window: SessionListWindow<T>,
): SessionListWindowsState<T> {
  if (scope.kind === 'general') {
    return { ...state, general: window };
  }
  return {
    ...state,
    projects: {
      ...state.projects,
      [scope.projectPath]: window,
    },
  };
}

function canMergeAdjacentPage<T extends { id: string }>(
  current: SessionListWindow<T>,
  incomingPage: SessionListPageInfo,
  mode: Exclude<SessionListPageMergeMode, 'replace'>,
): boolean {
  const first = current.pages[0];
  const last = current.pages[current.pages.length - 1];
  if (first === undefined || last === undefined || first.page.revision !== incomingPage.revision) {
    return false;
  }
  if (current.pages.some((page) => page.page.pageIndex === incomingPage.pageIndex)) {
    return true;
  }
  return mode === 'append'
    ? incomingPage.pageIndex === last.page.pageIndex + 1
    : incomingPage.pageIndex === first.page.pageIndex - 1;
}

/**
 * Merge one Host page into a small bidirectional window.
 *
 * A different revision or non-adjacent response is an authority reset, not an
 * opportunity to splice incompatible indexes. When the budget is exceeded we
 * evict from the side farthest from the user's loading direction.
 */
export function mergeSessionListWindowPage<T extends { id: string }>(
  state: SessionListWindowsState<T>,
  scope: SessionScope,
  incoming: { page: SessionListPageInfo; items: readonly T[] },
  mode: SessionListPageMergeMode = 'replace',
  options: { maximumPages?: number; maximumBytes?: number } = {},
): SessionListWindowsState<T> {
  const maximumPages = options.maximumPages ?? SESSION_LIST_WINDOW_MAX_PAGES;
  const maximumBytes = options.maximumBytes ?? SESSION_LIST_WINDOW_MAX_BYTES;
  if (!Number.isSafeInteger(maximumPages) || maximumPages <= 0) {
    throw new RangeError('Session list window maximumPages must be a positive integer');
  }
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes <= 0) {
    throw new RangeError('Session list window maximumBytes must be a positive integer');
  }

  const incomingSlice: SessionListWindowPage<T> = {
    page: incoming.page,
    items: [...incoming.items],
    retainedBytes: measureRetainedBytes(incoming.items),
  };
  const current = getSessionListWindow(state, scope);
  const shouldMerge =
    mode !== 'replace' && current !== null && canMergeAdjacentPage(current, incoming.page, mode);
  let pages = shouldMerge ? [...current.pages] : [];
  const existingIndex = pages.findIndex((page) => page.page.pageIndex === incoming.page.pageIndex);
  if (existingIndex >= 0) {
    pages[existingIndex] = incomingSlice;
  } else {
    pages.push(incomingSlice);
  }
  pages.sort((left, right) => left.page.pageIndex - right.page.pageIndex);

  const trimFromStart = mode !== 'prepend';
  const retainedBytes = (): number => pages.reduce((total, page) => total + page.retainedBytes, 0);
  while (pages.length > 1 && (pages.length > maximumPages || retainedBytes() > maximumBytes)) {
    if (trimFromStart) {
      pages = pages.slice(1);
    } else {
      pages = pages.slice(0, -1);
    }
  }

  return setSessionListWindow(state, scope, { pages });
}

export function flattenSessionListWindow<T extends { id: string }>(
  window: SessionListWindow<T>,
): T[] {
  const seen = new Set<string>();
  const items: T[] = [];
  for (const page of window.pages) {
    for (const item of page.items) {
      if (seen.has(item.id)) {
        continue;
      }
      seen.add(item.id);
      items.push(item);
    }
  }
  return items;
}

export function getSessionListWindowBounds<T extends { id: string }>(
  window: SessionListWindow<T>,
): SessionListWindowBounds | null {
  const first = window.pages[0];
  const last = window.pages[window.pages.length - 1];
  if (first === undefined || last === undefined) {
    return null;
  }
  return {
    firstPageIndex: first.page.pageIndex,
    lastPageIndex: last.page.pageIndex,
    pageCount: last.page.pageCount,
    totalCount: last.page.totalCount,
    retainedBytes: window.pages.reduce((total, page) => total + page.retainedBytes, 0),
    ...(first.page.previousCursor !== undefined
      ? { previousCursor: first.page.previousCursor }
      : {}),
    ...(last.page.nextCursor !== undefined ? { nextCursor: last.page.nextCursor } : {}),
  };
}
