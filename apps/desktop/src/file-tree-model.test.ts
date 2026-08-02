// apps/desktop/src/file-tree-model.test.ts
import { describe, expect, it } from 'vitest';
import type { GitChangedFile } from '@piwin/contracts';
import {
  buildGitStatusByPath,
  filterTreeNodes,
  flattenVisibleRows,
  gitStatusForPath,
  keyboardMove,
  type FileTreeNodeState,
} from './file-tree-model';

function file(name: string, relativePath: string): FileTreeNodeState {
  return {
    entry: { name, relativePath, kind: 'file' },
    expanded: false,
    loading: false,
    children: [],
    error: null,
  };
}

function dir(
  name: string,
  relativePath: string,
  children: FileTreeNodeState[] | null,
  expanded = false,
): FileTreeNodeState {
  return {
    entry: { name, relativePath, kind: 'directory' },
    expanded,
    loading: false,
    children,
    error: null,
  };
}

describe('buildGitStatusByPath', () => {
  it('maps path → status; last write wins on duplicates', () => {
    const files: GitChangedFile[] = [
      { path: 'src/a.ts', status: 'modified', staged: false, unstaged: true },
      { path: 'src/b.ts', status: 'added', staged: true, unstaged: false },
    ];
    const map = buildGitStatusByPath(files);
    expect(map.get('src/a.ts')).toBe('modified');
    expect(map.get('src/b.ts')).toBe('added');
  });
});

describe('gitStatusForPath', () => {
  it('returns the status for a matching file path, null for non-matching', () => {
    const map = buildGitStatusByPath([
      { path: 'src/a.ts', status: 'modified', staged: false, unstaged: true },
    ]);
    expect(gitStatusForPath(map, 'src/a.ts', 'file')).toBe('modified');
    expect(gitStatusForPath(map, 'src/other.ts', 'file')).toBe(null);
  });

  it('aggregates folder status from any descendant path under the prefix', () => {
    const map = buildGitStatusByPath([
      { path: 'src/a.ts', status: 'added', staged: true, unstaged: false },
      { path: 'other/b.ts', status: 'modified', staged: false, unstaged: true },
    ]);
    expect(gitStatusForPath(map, 'src', 'directory')).toBe('added');
    expect(gitStatusForPath(map, 'nope', 'directory')).toBe(null);
  });

  it('prioritizes conflicted over modified among folder descendants', () => {
    const map = buildGitStatusByPath([
      { path: 'src/a.ts', status: 'modified', staged: false, unstaged: true },
      { path: 'src/b.ts', status: 'conflicted', staged: false, unstaged: false },
    ]);
    expect(gitStatusForPath(map, 'src', 'directory')).toBe('conflicted');
  });

  it('returns null for an empty map or no match', () => {
    expect(gitStatusForPath(new Map(), 'src', 'directory')).toBe(null);
    expect(gitStatusForPath(new Map(), 'src/a.ts', 'file')).toBe(null);
  });

  it('tints the root directory when any descendant is changed', () => {
    const map = buildGitStatusByPath([
      { path: 'src/a.ts', status: 'modified', staged: false, unstaged: true },
    ]);
    expect(gitStatusForPath(map, '', 'directory')).toBe('modified');
  });
});

describe('filterTreeNodes', () => {
  const tree = [
    dir('src', 'src', [file('App.tsx', 'src/App.tsx'), file('util.ts', 'src/util.ts')], true),
    file('README.md', 'README.md'),
  ];

  it('returns all when query empty', () => {
    expect(filterTreeNodes(tree, '')).toEqual(tree);
  });

  it('keeps matching files and ancestor dirs', () => {
    const filtered = filterTreeNodes(tree, 'app');
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.entry.relativePath).toBe('src');
    expect(filtered[0]?.children?.map((c) => c.entry.name)).toEqual(['App.tsx']);
    expect(filtered[0]?.expanded).toBe(true);
  });
});

describe('flattenVisibleRows', () => {
  it('emits only expanded directory children', () => {
    const tree = [
      dir('src', 'src', [file('a.ts', 'src/a.ts')], true),
      dir('docs', 'docs', [file('x.md', 'docs/x.md')], false),
    ];
    const rows = flattenVisibleRows(tree);
    expect(rows.map((r) => r.relativePath)).toEqual(['src', 'src/a.ts', 'docs']);
  });
});

describe('keyboardMove', () => {
  const rows = [
    { relativePath: 'src', depth: 0, kind: 'directory' as const, name: 'src', expanded: true },
    { relativePath: 'src/a.ts', depth: 1, kind: 'file' as const, name: 'a.ts' },
    { relativePath: 'README.md', depth: 0, kind: 'file' as const, name: 'README.md' },
  ];

  it('ArrowDown moves to next row', () => {
    expect(keyboardMove(rows, 'src', 'ArrowDown')?.nextPath).toBe('src/a.ts');
  });

  it('ArrowUp moves to previous row', () => {
    expect(keyboardMove(rows, 'src/a.ts', 'ArrowUp')?.nextPath).toBe('src');
  });

  it('ArrowLeft on expanded dir requests collapse', () => {
    expect(keyboardMove(rows, 'src', 'ArrowLeft')).toEqual({
      nextPath: 'src',
      collapsePath: 'src',
    });
  });

  it('ArrowRight on collapsed dir requests expand', () => {
    const first = rows[0];
    const last = rows[2];
    const collapsed = first && last ? [{ ...first, expanded: false }, last] : [];
    expect(keyboardMove(collapsed, 'src', 'ArrowRight')).toEqual({
      nextPath: 'src',
      expandPath: 'src',
    });
  });

  it('Home moves to the first row', () => {
    expect(keyboardMove(rows, 'src/a.ts', 'Home')).toEqual({ nextPath: 'src' });
  });

  it('End moves to the last row', () => {
    expect(keyboardMove(rows, 'src', 'End')).toEqual({ nextPath: 'README.md' });
  });

  it('Enter on file returns activate', () => {
    expect(keyboardMove(rows, 'README.md', 'Enter')).toEqual({
      nextPath: 'README.md',
      activatePath: 'README.md',
    });
  });
});
