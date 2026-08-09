import { describe, expect, it } from 'vitest';
import {
  createSessionListWindowsState,
  flattenSessionListWindow,
  getSessionListWindow,
  getSessionListWindowBounds,
  mergeSessionListWindowPage,
  sessionScopeKey,
} from './session-list-page-state';

function page(
  pageIndex: number,
  overrides: Partial<{
    revision: string;
    pageCount: number;
    totalCount: number;
    previousCursor: string;
    nextCursor: string;
  }> = {},
) {
  return {
    revision: overrides.revision ?? 'revision',
    pageIndex,
    pageCount: overrides.pageCount ?? 8,
    totalCount: overrides.totalCount ?? 48,
    ...(overrides.previousCursor !== undefined ? { previousCursor: overrides.previousCursor } : {}),
    ...(overrides.nextCursor !== undefined ? { nextCursor: overrides.nextCursor } : {}),
  };
}

function item(id: string, name = id): { id: string; name: string } {
  return { id, name };
}

describe('session list lazy window state', () => {
  it('keeps General and project windows independent', () => {
    let state = createSessionListWindowsState<{ id: string; name: string }>();
    state = mergeSessionListWindowPage(
      state,
      { kind: 'general' },
      { page: page(1), items: [item('general')] },
    );
    state = mergeSessionListWindowPage(
      state,
      { kind: 'project', projectPath: '/project' },
      { page: page(2), items: [item('project')] },
    );

    const generalWindow = getSessionListWindow(state, { kind: 'general' });
    expect(generalWindow === null ? null : getSessionListWindowBounds(generalWindow)).toMatchObject(
      {
        firstPageIndex: 1,
        lastPageIndex: 1,
      },
    );
    const projectWindow = getSessionListWindow(state, {
      kind: 'project',
      projectPath: '/project',
    });
    expect(projectWindow === null ? [] : flattenSessionListWindow(projectWindow)).toEqual([
      item('project'),
    ]);
  });

  it('appends adjacent pages and evicts the farthest page at the page budget', () => {
    let state = createSessionListWindowsState<{ id: string; name: string }>();
    const scope = { kind: 'general' } as const;
    for (let pageIndex = 0; pageIndex < 4; pageIndex += 1) {
      state = mergeSessionListWindowPage(
        state,
        scope,
        {
          page: page(pageIndex, {
            ...(pageIndex > 0 ? { previousCursor: `previous-${pageIndex}` } : {}),
            ...(pageIndex < 7 ? { nextCursor: `next-${pageIndex}` } : {}),
          }),
          items: [item(`session-${pageIndex}`)],
        },
        pageIndex === 0 ? 'replace' : 'append',
        { maximumPages: 3 },
      );
    }

    const window = getSessionListWindow(state, scope);
    expect(
      window === null ? [] : flattenSessionListWindow(window).map((entry) => entry.id),
    ).toEqual(['session-1', 'session-2', 'session-3']);
    expect(window === null ? null : getSessionListWindowBounds(window)).toMatchObject({
      firstPageIndex: 1,
      lastPageIndex: 3,
      previousCursor: 'previous-1',
      nextCursor: 'next-3',
    });
  });

  it('prepends adjacent pages and evicts from the opposite end', () => {
    let state = createSessionListWindowsState<{ id: string; name: string }>();
    const scope = { kind: 'project', projectPath: '/project' } as const;
    for (let pageIndex = 4; pageIndex >= 1; pageIndex -= 1) {
      state = mergeSessionListWindowPage(
        state,
        scope,
        {
          page: page(pageIndex, {
            previousCursor: `previous-${pageIndex}`,
            nextCursor: `next-${pageIndex}`,
          }),
          items: [item(`session-${pageIndex}`)],
        },
        pageIndex === 4 ? 'replace' : 'prepend',
        { maximumPages: 3 },
      );
    }

    const window = getSessionListWindow(state, scope);
    expect(
      window === null ? [] : flattenSessionListWindow(window).map((entry) => entry.id),
    ).toEqual(['session-1', 'session-2', 'session-3']);
  });

  it('resets instead of splicing a stale revision or non-adjacent page', () => {
    const scope = { kind: 'general' } as const;
    let state = mergeSessionListWindowPage(
      createSessionListWindowsState<{ id: string; name: string }>(),
      scope,
      { page: page(4), items: [item('old')] },
    );
    state = mergeSessionListWindowPage(
      state,
      scope,
      { page: page(0, { revision: 'replacement' }), items: [item('new')] },
      'append',
    );

    const window = getSessionListWindow(state, scope);
    expect(window === null ? [] : flattenSessionListWindow(window)).toEqual([item('new')]);
    expect(window === null ? null : getSessionListWindowBounds(window)?.firstPageIndex).toBe(0);
  });

  it('deduplicates session identities across adjacent pages', () => {
    const scope = { kind: 'general' } as const;
    let state = mergeSessionListWindowPage(
      createSessionListWindowsState<{ id: string; name: string }>(),
      scope,
      { page: page(0), items: [item('shared'), item('first')] },
    );
    state = mergeSessionListWindowPage(
      state,
      scope,
      { page: page(1), items: [item('shared'), item('second')] },
      'append',
    );

    const window = getSessionListWindow(state, scope);
    expect(
      window === null ? [] : flattenSessionListWindow(window).map((entry) => entry.id),
    ).toEqual(['shared', 'first', 'second']);
  });

  it('retains only three pages after walking a 10,000-session projection', () => {
    const scope = { kind: 'project', projectPath: '/large-project' } as const;
    const pageCount = Math.ceil(10_000 / 6);
    let state = createSessionListWindowsState<{ id: string; name: string }>();
    for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
      const firstItem = pageIndex * 6;
      const itemCount = Math.min(6, 10_000 - firstItem);
      state = mergeSessionListWindowPage(
        state,
        scope,
        {
          page: page(pageIndex, {
            pageCount,
            totalCount: 10_000,
            ...(pageIndex > 0 ? { previousCursor: `previous-${pageIndex}` } : {}),
            ...(pageIndex < pageCount - 1 ? { nextCursor: `next-${pageIndex}` } : {}),
          }),
          items: Array.from({ length: itemCount }, (_, offset) =>
            item(`session-${firstItem + offset}`),
          ),
        },
        pageIndex === 0 ? 'replace' : 'append',
      );
    }

    const window = getSessionListWindow(state, scope);
    expect(window?.pages).toHaveLength(3);
    expect(window === null ? [] : flattenSessionListWindow(window)).toHaveLength(16);
    expect(window === null ? null : getSessionListWindowBounds(window)).toMatchObject({
      firstPageIndex: pageCount - 3,
      lastPageIndex: pageCount - 1,
      totalCount: 10_000,
    });
  });

  it('also trims by retained UTF-8 bytes', () => {
    const scope = { kind: 'general' } as const;
    let state = mergeSessionListWindowPage(
      createSessionListWindowsState<{ id: string; name: string }>(),
      scope,
      { page: page(0), items: [item('first', 'x'.repeat(80))] },
      'replace',
      { maximumBytes: 150 },
    );
    state = mergeSessionListWindowPage(
      state,
      scope,
      { page: page(1), items: [item('second', 'y'.repeat(80))] },
      'append',
      { maximumBytes: 150 },
    );

    const window = getSessionListWindow(state, scope);
    expect(
      window === null ? [] : flattenSessionListWindow(window).map((entry) => entry.id),
    ).toEqual(['second']);
  });

  it('uses collision-free keys for General and project paths', () => {
    expect(sessionScopeKey({ kind: 'general' })).toBe('general');
    expect(sessionScopeKey({ kind: 'project', projectPath: '/project' })).toBe('project:/project');
  });
});
