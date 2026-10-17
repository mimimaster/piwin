import { describe, expect, it } from 'vitest';

import { splitPinnedShelfRows } from './sidebar-pinned-shelf';
import type { SidebarTreeRow } from './sidebar-tree-rows';

function header(sectionId: 'pinned' | 'projects' | 'conversations'): SidebarTreeRow {
  return { kind: 'section-header', sectionId, key: `section:${sectionId}` };
}

function session(id: string): SidebarTreeRow {
  return {
    kind: 'session',
    scope: { kind: 'general' },
    session: { id, name: id, updatedAt: '2026-01-01T00:00:00.000Z' } as never,
    key: `session:${id}`,
  };
}

const keys = (rows: readonly SidebarTreeRow[]): string[] => rows.map((row) => row.key);

describe('splitPinnedShelfRows', () => {
  it('lifts the pinned header and its rows out of the scroll list', () => {
    const split = splitPinnedShelfRows([
      header('pinned'),
      session('pin-a'),
      session('pin-b'),
      header('conversations'),
      session('chat-a'),
    ]);
    expect(keys(split.shelfRows)).toEqual(['section:pinned', 'session:pin-a', 'session:pin-b']);
    expect(keys(split.scrollRows)).toEqual(['section:conversations', 'session:chat-a']);
  });

  it('keeps a collapsed pinned header on the shelf', () => {
    const split = splitPinnedShelfRows([header('pinned'), header('projects'), session('proj-a')]);
    expect(keys(split.shelfRows)).toEqual(['section:pinned']);
    expect(keys(split.scrollRows)).toEqual(['section:projects', 'session:proj-a']);
  });

  it('leaves the shelf empty when there is no pinned section', () => {
    const rows = [header('projects'), session('proj-a')];
    const split = splitPinnedShelfRows(rows);
    expect(split.shelfRows).toEqual([]);
    expect(keys(split.scrollRows)).toEqual(keys(rows));
  });

  it('keeps rows emitted before any header in the scroll list', () => {
    const split = splitPinnedShelfRows([session('loose'), header('pinned'), session('pin-a')]);
    expect(keys(split.shelfRows)).toEqual(['section:pinned', 'session:pin-a']);
    expect(keys(split.scrollRows)).toEqual(['session:loose']);
  });
});
