import { describe, expect, it } from 'vitest';
import { collectWorkspaceFileIndex, type AtFileIndexListDirectory } from './at-file-index';

type Listed = { relativePath: string; kind: 'file' | 'directory' };

function lister(tree: Record<string, readonly Listed[]>): AtFileIndexListDirectory {
  return async (relativePath) => tree[relativePath] ?? [];
}

describe('collectWorkspaceFileIndex', () => {
  it('walks breadth-first so shallow paths land before deep subtrees', async () => {
    const listed: string[] = [];
    const listDirectory: AtFileIndexListDirectory = async (relativePath) => {
      listed.push(relativePath);
      if (relativePath === '') {
        return [
          { relativePath: 'package.json', kind: 'file' },
          { relativePath: 'src', kind: 'directory' },
        ];
      }
      if (relativePath === 'src') {
        return [
          { relativePath: 'src/App.tsx', kind: 'file' },
          { relativePath: 'src/lib', kind: 'directory' },
        ];
      }
      if (relativePath === 'src/lib') {
        return [{ relativePath: 'src/lib/util.ts', kind: 'file' }];
      }
      return [];
    };

    const entries = await collectWorkspaceFileIndex(listDirectory);
    expect(listed).toEqual(['', 'src', 'src/lib']);
    expect(entries.map((entry) => entry.relativePath)).toEqual([
      'package.json',
      'src',
      'src/App.tsx',
      'src/lib',
      'src/lib/util.ts',
    ]);
  });

  it('does not descend past maxDepth', async () => {
    const listDirectory = lister({
      '': [
        { relativePath: 'readme.md', kind: 'file' },
        { relativePath: 'src', kind: 'directory' },
      ],
      src: [{ relativePath: 'src/App.tsx', kind: 'file' }],
    });

    const entries = await collectWorkspaceFileIndex(listDirectory, { maxDepth: 1 });
    expect(entries.map((entry) => entry.relativePath)).toEqual(['readme.md', 'src']);
  });

  it('stops after maxDirectories without listing remaining queued dirs', async () => {
    const listed: string[] = [];
    const listDirectory: AtFileIndexListDirectory = async (relativePath) => {
      listed.push(relativePath);
      if (relativePath === '') {
        return [
          { relativePath: 'a', kind: 'directory' },
          { relativePath: 'b', kind: 'directory' },
        ];
      }
      return [{ relativePath: `${relativePath}/file.ts`, kind: 'file' }];
    };

    const entries = await collectWorkspaceFileIndex(listDirectory, { maxDirectories: 1 });
    expect(listed).toEqual(['']);
    expect(entries.map((entry) => entry.relativePath)).toEqual(['a', 'b']);
  });

  it('stops after maxEntries even when more siblings remain', async () => {
    const entries = await collectWorkspaceFileIndex(
      lister({
        '': [
          { relativePath: 'a.ts', kind: 'file' },
          { relativePath: 'b.ts', kind: 'file' },
          { relativePath: 'c.ts', kind: 'file' },
          { relativePath: 'd.ts', kind: 'file' },
        ],
      }),
      { maxEntries: 2 },
    );
    expect(entries.map((entry) => entry.relativePath)).toEqual(['a.ts', 'b.ts']);
  });

  it('continues after a single directory list failure', async () => {
    const listDirectory: AtFileIndexListDirectory = async (relativePath) => {
      if (relativePath === 'broken') {
        throw new Error('permission denied');
      }
      if (relativePath === '') {
        return [
          { relativePath: 'broken', kind: 'directory' },
          { relativePath: 'ok.ts', kind: 'file' },
          { relativePath: 'src', kind: 'directory' },
        ];
      }
      if (relativePath === 'src') {
        return [{ relativePath: 'src/index.ts', kind: 'file' }];
      }
      return [];
    };

    const entries = await collectWorkspaceFileIndex(listDirectory);
    expect(entries.map((entry) => entry.relativePath)).toEqual([
      'broken',
      'ok.ts',
      'src',
      'src/index.ts',
    ]);
  });

  it('returns early when isCancelled is already true', async () => {
    let listed = 0;
    const entries = await collectWorkspaceFileIndex(
      async () => {
        listed += 1;
        return [{ relativePath: 'a.ts', kind: 'file' }];
      },
      { isCancelled: () => true },
    );
    expect(listed).toBe(0);
    expect(entries).toEqual([]);
  });

  it('normalizes separators and leading slashes, then dedupes', async () => {
    const entries = await collectWorkspaceFileIndex(
      lister({
        '': [
          { relativePath: '\\src\\App.tsx', kind: 'file' },
          { relativePath: '/src/App.tsx', kind: 'file' },
          { relativePath: 'src/App.tsx/', kind: 'file' },
          { relativePath: 'src', kind: 'directory' },
        ],
      }),
    );
    expect(entries).toEqual([
      { relativePath: 'src/App.tsx', kind: 'file' },
      { relativePath: 'src', kind: 'directory' },
    ]);
  });
});
