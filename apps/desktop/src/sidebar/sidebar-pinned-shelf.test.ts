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
  it('lifts the pinned header and its rows plus the pane section header out of the scroll list', () => {
    const split = splitPinnedShelfRows([
      header('pinned'),
      session('pin-a'),
      session('pin-b'),
      header('conversations'),
      session('chat-a'),
    ]);
    expect(keys(split.shelfRows)).toEqual(['section:pinned', 'session:pin-a', 'session:pin-b']);
    expect(split.paneHeaderRow?.key).toBe('section:conversations');
    expect(keys(split.scrollRows)).toEqual(['session:chat-a']);
  });

  it('keeps a collapsed pinned header on the shelf and lifts the pane section header', () => {
    const split = splitPinnedShelfRows([header('pinned'), header('projects'), session('proj-a')]);
    expect(keys(split.shelfRows)).toEqual(['section:pinned']);
    expect(split.paneHeaderRow?.key).toBe('section:projects');
    expect(keys(split.scrollRows)).toEqual(['session:proj-a']);
  });

  it('lifts the pane section header even when there is no pinned section', () => {
    const split = splitPinnedShelfRows([header('projects'), session('proj-a')]);
    expect(split.shelfRows).toEqual([]);
    expect(split.paneHeaderRow?.key).toBe('section:projects');
    expect(keys(split.scrollRows)).toEqual(['session:proj-a']);
  });

  it('keeps rows emitted before any header in the scroll list and lifts only a leading pane header', () => {
    const split = splitPinnedShelfRows([
      session('loose'),
      header('pinned'),
      session('pin-a'),
      header('projects'),
      session('proj-a'),
      header('conversations'),
      session('chat-a'),
    ]);
    expect(keys(split.shelfRows)).toEqual(['section:pinned', 'session:pin-a']);
    expect(split.paneHeaderRow).toBeNull();
    expect(keys(split.scrollRows)).toEqual([
      'session:loose',
      'section:projects',
      'session:proj-a',
      'section:conversations',
      'session:chat-a',
    ]);
  });

  it('keeps subsequent non-pinned headers inside scrollRows when multiple appear', () => {
    const split = splitPinnedShelfRows([
      header('projects'),
      session('proj-a'),
      header('conversations'),
      session('chat-a'),
    ]);
    expect(split.shelfRows).toEqual([]);
    expect(split.paneHeaderRow?.key).toBe('section:projects');
    expect(keys(split.scrollRows)).toEqual(['session:proj-a', 'section:conversations', 'session:chat-a']);
  });
});
