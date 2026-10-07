import { describe, expect, it } from 'vitest';
import { areFileTreeNodePropsEqual, type FileTreeNodeViewProps } from './file-tree-node-view';
import type { FileTreeNodeState } from './file-tree-model';

function node(relativePath: string, kind: 'file' | 'directory'): FileTreeNodeState {
  return {
    entry: { name: relativePath.split('/').pop() ?? relativePath, relativePath, kind },
    expanded: kind === 'directory',
    loading: false,
    children: kind === 'directory' ? [] : null,
    error: null,
  } as FileTreeNodeState;
}

const SHARED = {
  depth: 0,
  gitStatusMap: new Map(),
  projectPath: '/repo',
  onSelectFile: () => undefined,
  onSelectPath: () => undefined,
  onToggle: () => undefined,
  onDragStart: () => undefined,
  absoluteFor: (path: string) => path,
  contextMenuCaps: {
    hasProject: true,
    canReveal: true,
    sideChatAvailable: false,
    applyAvailable: false,
    canSendPreset: false,
    locale: 'en',
  },
  contextMenuDispatchers: {} as FileTreeNodeViewProps['contextMenuDispatchers'],
  enableContextMenu: true,
} satisfies Omit<FileTreeNodeViewProps, 'node' | 'selectedPath'>;

function propsFor(target: FileTreeNodeState, selectedPath: string | null): FileTreeNodeViewProps {
  return { ...SHARED, node: target, selectedPath };
}

describe('areFileTreeNodePropsEqual', () => {
  const src = node('src', 'directory');
  const srcSibling = node('src-old', 'directory');
  const file = node('src/app.ts', 'file');

  it('sits out a selection change elsewhere in the tree', () => {
    expect(
      areFileTreeNodePropsEqual(propsFor(file, 'docs/a.md'), propsFor(file, 'docs/b.md')),
    ).toBe(true);
    expect(
      areFileTreeNodePropsEqual(propsFor(src, 'docs/a.md'), propsFor(src, 'docs/b.md')),
    ).toBe(true);
  });

  it('re-renders the row that gains or loses the selection', () => {
    expect(
      areFileTreeNodePropsEqual(propsFor(file, 'docs/a.md'), propsFor(file, 'src/app.ts')),
    ).toBe(false);
    expect(
      areFileTreeNodePropsEqual(propsFor(file, 'src/app.ts'), propsFor(file, null)),
    ).toBe(false);
  });

  it('re-renders the directories above the selection so it reaches the row', () => {
    expect(
      areFileTreeNodePropsEqual(propsFor(src, null), propsFor(src, 'src/app.ts')),
    ).toBe(false);
  });

  it('does not mistake a sibling sharing a name prefix for an ancestor', () => {
    expect(
      areFileTreeNodePropsEqual(propsFor(srcSibling, null), propsFor(srcSibling, 'src/app.ts')),
    ).toBe(true);
    expect(
      areFileTreeNodePropsEqual(propsFor(src, null), propsFor(src, 'src-old/app.ts')),
    ).toBe(true);
  });

  it('re-renders when any other prop changes identity', () => {
    expect(
      areFileTreeNodePropsEqual(propsFor(file, null), {
        ...propsFor(file, null),
        gitStatusMap: new Map(),
      }),
    ).toBe(false);
    expect(
      areFileTreeNodePropsEqual(propsFor(file, null), propsFor({ ...file }, null)),
    ).toBe(false);
  });
});
