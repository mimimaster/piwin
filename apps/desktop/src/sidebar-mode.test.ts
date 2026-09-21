import { describe, expect, it } from 'vitest';

import {
  filterSidebarRowsByMode,
  isSidebarMode,
  loadSidebarMode,
  saveSidebarMode,
  SIDEBAR_MODE_STORAGE_KEY,
} from './sidebar-mode';
import type { SidebarTreeRow } from './sidebar-tree-rows';

function header(sectionId: 'pinned' | 'projects' | 'conversations'): SidebarTreeRow {
  return { kind: 'section-header', sectionId, key: `section:${sectionId}` };
}

function session(id: string, scope: 'general' | string): SidebarTreeRow {
  return {
    kind: 'session',
    scope: scope === 'general' ? { kind: 'general' } : { kind: 'project', projectPath: scope },
    session: { id, name: id, updatedAt: '2026-01-01T00:00:00.000Z' } as never,
    key: `session:${id}`,
  };
}

const ROWS: SidebarTreeRow[] = [
  header('pinned'),
  session('pinned-chat', 'general'),
  session('pinned-proj', '/w/piwin'),
  header('projects'),
  { kind: 'project-folder', projectPath: '/w/piwin', collapsed: false, grouped: false, currentBranch: 'main', key: 'folder:/w/piwin' },
  session('proj-a', '/w/piwin'),
  header('conversations'),
  { kind: 'time-group', id: 'today', title: '今天', key: 'time:today' },
  session('chat-a', 'general'),
];

const keys = (rows: readonly SidebarTreeRow[]) => rows.map((r) => r.key);

describe('filterSidebarRowsByMode', () => {
  it('keeps conversations and pinned conversations in chat mode', () => {
    expect(keys(filterSidebarRowsByMode(ROWS, 'chat'))).toEqual([
      'section:pinned',
      'session:pinned-chat',
      'section:conversations',
      'time:today',
      'session:chat-a',
    ]);
  });

  it('keeps projects and pinned project sessions in code mode', () => {
    expect(keys(filterSidebarRowsByMode(ROWS, 'code'))).toEqual([
      'section:pinned',
      'session:pinned-proj',
      'section:projects',
      'folder:/w/piwin',
      'session:proj-a',
    ]);
  });

  it('drops the pinned header when this pane has nothing pinned', () => {
    const rows: SidebarTreeRow[] = [
      header('pinned'),
      session('pinned-proj', '/w/piwin'),
      header('conversations'),
      session('chat-a', 'general'),
    ];
    expect(keys(filterSidebarRowsByMode(rows, 'chat'))).toEqual([
      'section:conversations',
      'session:chat-a',
    ]);
  });

  it('drops a trailing pinned header with no body', () => {
    expect(keys(filterSidebarRowsByMode([header('pinned')], 'chat'))).toEqual([]);
  });

  it('leaves rows before any section header alone in both panes', () => {
    const rows: SidebarTreeRow[] = [{ kind: 'no-repo-folder', key: 'no-repo', collapsed: true }, ...ROWS];
    expect(keys(filterSidebarRowsByMode(rows, 'chat'))[0]).toBe('no-repo');
    expect(keys(filterSidebarRowsByMode(rows, 'code'))[0]).toBe('no-repo');
  });
});

describe('sidebar mode storage', () => {
  it('accepts only the two modes', () => {
    expect(isSidebarMode('chat')).toBe(true);
    expect(isSidebarMode('code')).toBe(true);
    expect(isSidebarMode('projects')).toBe(false);
    expect(isSidebarMode(null)).toBe(false);
  });

  it('round-trips through storage and defaults to chat', () => {
    const bag = new Map<string, string>();
    const store = {
      getItem: (k: string) => bag.get(k) ?? null,
      setItem: (k: string, v: string) => void bag.set(k, v),
    };
    expect(loadSidebarMode(store)).toBe('chat');
    saveSidebarMode('code', store);
    expect(bag.get(SIDEBAR_MODE_STORAGE_KEY)).toBe('code');
    expect(loadSidebarMode(store)).toBe('code');
  });

  it('falls back to chat when storage throws', () => {
    const store = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    };
    expect(loadSidebarMode(store)).toBe('chat');
    expect(() => saveSidebarMode('code', store)).not.toThrow();
  });
});
