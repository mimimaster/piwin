import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  normalizeProjectFileQuery,
  projectFileQueryMatches,
  searchProjectFiles,
} from './project-file-search.js';

async function createTree(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'piwin-file-search-'));
  await mkdir(join(root, 'docs/design/inkstone/shots'), { recursive: true });
  await mkdir(join(root, 'node_modules/pkg'), { recursive: true });
  await mkdir(join(root, 'src'), { recursive: true });
  await writeFile(join(root, 'docs/design/inkstone/shots/01-endpoint-loop.png'), 'a');
  await writeFile(join(root, 'docs/design/inkstone/shots/README.md'), 'b');
  await writeFile(join(root, 'node_modules/pkg/01-endpoint-loop.png'), 'c');
  await writeFile(join(root, 'src/01-endpoint-loop.png'), 'd');
  await writeFile(join(root, 'src/main.ts'), 'e');
  return root;
}

describe('normalizeProjectFileQuery', () => {
  it('strips separators and leading ./ so the same name always matches', () => {
    expect(normalizeProjectFileQuery('./src/main.ts')).toBe('src/main.ts');
    expect(normalizeProjectFileQuery('  /docs/shots/  ')).toBe('docs/shots');
    expect(normalizeProjectFileQuery('shots\\a.png')).toBe('shots/a.png');
  });
});

describe('projectFileQueryMatches', () => {
  it('matches a bare name at any depth', () => {
    expect(projectFileQueryMatches('a/b/c.png', 'c.png')).toBe(true);
    expect(projectFileQueryMatches('a/b/c.png', 'd.png')).toBe(false);
  });

  it('matches a path fragment on segment boundaries only', () => {
    expect(projectFileQueryMatches('docs/shots/a.png', 'shots/a.png')).toBe(true);
    expect(projectFileQueryMatches('docs/shots/a.png', 'hots/a.png')).toBe(false);
    expect(projectFileQueryMatches('docs/shots/a.png', 'docs/shots/a.png')).toBe(true);
  });
});

describe('searchProjectFiles', () => {
  it('finds a bare file name in a subfolder, ignoring vendored directories', async () => {
    const root = await createTree();
    const result = await searchProjectFiles({ rootAbsolute: root, query: '01-endpoint-loop.png' });
    expect(result.truncated).toBe(false);
    expect(result.matches.map((match) => match.relativePath)).toEqual([
      'src/01-endpoint-loop.png',
      'docs/design/inkstone/shots/01-endpoint-loop.png',
    ]);
    expect(result.matches[0]?.sizeBytes).toBe(1);
  });

  it('resolves a directory fragment the message got wrong', async () => {
    const root = await createTree();
    const result = await searchProjectFiles({ rootAbsolute: root, query: 'shots/README.md' });
    expect(result.matches.map((match) => match.relativePath)).toEqual([
      'docs/design/inkstone/shots/README.md',
    ]);
  });

  it('reports no match instead of guessing', async () => {
    const root = await createTree();
    const result = await searchProjectFiles({ rootAbsolute: root, query: 'missing.png' });
    expect(result.matches).toEqual([]);
  });

  it('stops at the match budget and says the list is incomplete', async () => {
    const root = await createTree();
    const result = await searchProjectFiles({
      rootAbsolute: root,
      query: '01-endpoint-loop.png',
      maxMatches: 1,
    });
    expect(result.matches).toHaveLength(1);
    expect(result.truncated).toBe(true);
  });

  it('stops at the visited budget on a wide tree', async () => {
    const root = await createTree();
    const result = await searchProjectFiles({
      rootAbsolute: root,
      query: '01-endpoint-loop.png',
      maxVisited: 3,
    });
    expect(result.truncated).toBe(true);
    expect(result.matches).toEqual([]);
  });

  it('never descends through a symlinked directory', async () => {
    const root = await createTree();
    const outside = await mkdtemp(join(tmpdir(), 'piwin-file-search-outside-'));
    await writeFile(join(outside, 'leaked.png'), 'x');
    await symlink(outside, join(root, 'linked'));
    const result = await searchProjectFiles({ rootAbsolute: root, query: 'leaked.png' });
    expect(result.matches).toEqual([]);
  });
});
