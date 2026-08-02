// apps/desktop/src/file-tree-model.test.ts
import { describe, expect, it } from 'vitest';
import type { GitChangedFile } from '@piwin/contracts';
import {
  buildGitStatusByPath,
  filterTreeNodes,
  flattenVisibleRows,
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
    const collapsed = [{ ...rows[0]!, expanded: false }, rows[2]!];
    expect(keyboardMove(collapsed, 'src', 'ArrowRight')).toEqual({
      nextPath: 'src',
      expandPath: 'src',
    });
  });

  it('Enter on file returns activate', () => {
    expect(keyboardMove(rows, 'README.md', 'Enter')).toEqual({
      nextPath: 'README.md',
      activatePath: 'README.md',
    });
  });
});
