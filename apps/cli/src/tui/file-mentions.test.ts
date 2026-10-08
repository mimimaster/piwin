import type { ProjectDirEntry } from '@piwin/contracts';
import { describe, expect, it } from 'vitest';
import {
  extractMentionPaths,
  findMentionAtCursor,
  mentionCompletionValue,
  mentionWithoutTrailingProse,
  normalizeMentionPath,
  rankDirEntries,
  rankIndexedEntries,
} from './file-mentions.js';

describe('findMentionAtCursor', () => {
  it('splits the typed path into directory and partial name', () => {
    expect(findMentionAtCursor('看看 @src/ui/but')).toEqual({ prefix: '@src/ui/but', directory: 'src/ui', namePart: 'but' });
    expect(findMentionAtCursor('@')).toEqual({ prefix: '@', directory: '', namePart: '' });
    expect(findMentionAtCursor('@src/')).toEqual({ prefix: '@src/', directory: 'src', namePart: '' });
  });

  it('follows an open quote so paths with spaces complete', () => {
    expect(findMentionAtCursor('读 @"docs/user gu')).toEqual({
      prefix: '@"docs/user gu',
      directory: 'docs',
      namePart: 'user gu',
    });
  });

  it('ignores an @ inside a word and a finished mention', () => {
    expect(findMentionAtCursor('mail me@example.com')).toBeUndefined();
    expect(findMentionAtCursor('@src/a.ts 然后')).toBeUndefined();
  });
});

describe('extractMentionPaths', () => {
  it('collects distinct mentions and drops sentence punctuation', () => {
    expect(extractMentionPaths('对比 @src/a.ts 和 @src/ui/，再看 @src/a.ts。')).toEqual(['src/a.ts', 'src/ui']);
  });

  it('reads quoted mentions whole', () => {
    expect(extractMentionPaths('读 @"docs/user guide.md" 吧')).toEqual(['docs/user guide.md']);
  });

  it('skips addresses and anything that could leave the project', () => {
    expect(extractMentionPaths('me@example.com @/etc/passwd @../x @~/y @C:/z')).toEqual([]);
  });
});

describe('mentionWithoutTrailingProse', () => {
  it('offers the ASCII head of a mention glued to prose', () => {
    expect(mentionWithoutTrailingProse('src/a.ts和别的')).toBe('src/a.ts');
    expect(mentionWithoutTrailingProse('src/a.ts')).toBeUndefined();
    expect(mentionWithoutTrailingProse('文档/说明.md')).toBeUndefined();
  });
});

describe('normalizeMentionPath', () => {
  it('strips ./ and trailing slashes', () => {
    expect(normalizeMentionPath('./src/ui/')).toBe('src/ui');
  });
});

describe('completion entries', () => {
  const entries: ProjectDirEntry[] = [
    { name: 'README.md', relativePath: 'README.md', kind: 'file' },
    { name: 'src', relativePath: 'src', kind: 'directory' },
    { name: 'assets', relativePath: 'assets', kind: 'directory' },
    { name: 'misc.ts', relativePath: 'misc.ts', kind: 'file' },
  ];

  it('lists directories first when nothing is typed', () => {
    expect(rankDirEntries(entries, '').map((entry) => entry.name)).toEqual(['assets', 'src', 'misc.ts', 'README.md']);
  });

  it('puts prefix matches ahead of substring matches, case-insensitively', () => {
    expect(rankDirEntries(entries, 's').map((entry) => entry.name)).toEqual(['src', 'assets', 'misc.ts']);
    expect(rankDirEntries(entries, 'read').map((entry) => entry.name)).toEqual(['README.md']);
  });

  it('searches the whole project, name hits before path hits, shallow before deep', () => {
    const indexed: ProjectDirEntry[] = [
      { name: 'index.ts', relativePath: 'src/button/index.ts', kind: 'file' },
      { name: 'icon-button.tsx', relativePath: 'src/ui/deep/icon-button.tsx', kind: 'file' },
      { name: 'button.tsx', relativePath: 'src/ui/button.tsx', kind: 'file' },
      { name: 'button', relativePath: 'src/button', kind: 'directory' },
      { name: 'a.ts', relativePath: 'src/a.ts', kind: 'file' },
    ];
    expect(rankIndexedEntries(indexed, 'Button', 10).map((entry) => entry.relativePath)).toEqual([
      'src/button',
      'src/ui/button.tsx',
      'src/ui/deep/icon-button.tsx',
      'src/button/index.ts',
    ]);
    expect(rankIndexedEntries(indexed, 'button', 2)).toHaveLength(2);
    expect(rankIndexedEntries(indexed, '', 10)).toEqual([]);
  });

  it('keeps a directory open for further completion and quotes spaces', () => {
    expect(mentionCompletionValue('src', 'directory')).toBe('@src/');
    expect(mentionCompletionValue('src/a.ts', 'file')).toBe('@src/a.ts');
    expect(mentionCompletionValue('docs/user guide.md', 'file')).toBe('@"docs/user guide.md"');
  });
});
