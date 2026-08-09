import { describe, expect, it } from 'vitest';
import { projectHostSessionPage, selectSessionSidebarPage } from './session-sidebar-page';

function sessions(count: number): Array<{ id: string }> {
  return Array.from({ length: count }, (_, index) => ({ id: `session-${index}` }));
}

describe('selectSessionSidebarPage', () => {
  it('keeps an authority-sized collection inside one fixed page', () => {
    const page = selectSessionSidebarPage(sessions(1_003), 6, 0, null);

    expect(page.items).toHaveLength(6);
    expect(page.items.map((session) => session.id)).toEqual([
      'session-0',
      'session-1',
      'session-2',
      'session-3',
      'session-4',
      'session-5',
    ]);
    expect(page.pageCount).toBe(168);
    expect(page.totalCount).toBe(1_003);
  });

  it('selects the active session page when navigation has no explicit page', () => {
    const page = selectSessionSidebarPage(sessions(1_003), 6, null, 'session-999');

    expect(page.pageIndex).toBe(166);
    expect(page.items).toHaveLength(6);
    expect(page.items.some((session) => session.id === 'session-999')).toBe(true);
  });

  it('honors an explicit page and clamps stale page indexes', () => {
    expect(selectSessionSidebarPage(sessions(13), 6, 1, 'session-12').pageIndex).toBe(1);
    expect(selectSessionSidebarPage(sessions(13), 6, 99, null).pageIndex).toBe(2);
    expect(selectSessionSidebarPage(sessions(13), 6, -5, null).pageIndex).toBe(0);
  });

  it('represents an empty collection without a synthetic page', () => {
    expect(selectSessionSidebarPage([], 6, null, null)).toEqual({
      items: [],
      pageIndex: 0,
      pageCount: 0,
      totalCount: 0,
    });
  });

  it('rejects an invalid page budget', () => {
    expect(() => selectSessionSidebarPage(sessions(1), 0, null, null)).toThrow(RangeError);
  });

  it('preserves Host page coordinates without slicing the bounded item array again', () => {
    const page = projectHostSessionPage(sessions(4), {
      revision: 'revision',
      pageIndex: 166,
      pageCount: 168,
      totalCount: 1_003,
      previousCursor: 'previous',
      nextCursor: 'next',
    });

    expect(page.items).toHaveLength(4);
    expect(page.pageIndex).toBe(166);
    expect(page.pageCount).toBe(168);
    expect(page.totalCount).toBe(1_003);
  });
});
