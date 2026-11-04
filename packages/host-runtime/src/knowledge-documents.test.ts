import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { KnowledgeBaseSummary } from '@piwin/contracts';
import type { FolderRag } from '@piwin/doc-rag';
import {
  KnowledgeDocumentError,
  listKnowledgeDocuments,
  readKnowledgeDocument,
  type KnowledgeDocumentsRuntime,
} from './knowledge-documents.js';
import { KnowledgePathEscapeError } from './knowledge-tools.js';

const cleanup: string[] = [];

afterEach(async () => {
  for (const dir of cleanup.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

async function makeFolder(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'piwin-kdocs-'));
  cleanup.push(root);
  for (const [relativePath, content] of Object.entries(files)) {
    const absolute = join(root, relativePath);
    await mkdir(join(absolute, '..'), { recursive: true });
    await writeFile(absolute, content, 'utf8');
  }
  return root;
}

function baseFor(folderPath: string): KnowledgeBaseSummary {
  return {
    id: 'folder:0123456789abcdef',
    kind: 'folder',
    name: 'docs',
    folderPath,
    state: 'not-indexed',
    degraded: false,
    documentCount: 0,
  };
}

function runtimeFor(
  folderPath: string,
  rag: Partial<FolderRag> | 'throws' = {},
): KnowledgeDocumentsRuntime {
  const stub: Partial<FolderRag> = {
    isIndexed: async () => false,
    listDocuments: async () => [],
    ...(rag === 'throws' ? {} : rag),
  };
  return {
    bases: [baseFor(folderPath)],
    getFolderRag: async () => {
      if (rag === 'throws') throw new Error('index unavailable');
      return stub as FolderRag;
    },
  };
}

describe('listKnowledgeDocuments', () => {
  it('lists an unindexed folder from the filesystem, never from the index', async () => {
    const folder = await makeFolder({
      'a.md': '# A',
      'sub/b.txt': 'b',
    });

    const result = await listKnowledgeDocuments(runtimeFor(folder), {
      baseId: 'folder:0123456789abcdef',
    });

    expect(result.items.map((item) => item.relativePath)).toEqual(['a.md', 'sub/b.txt']);
    expect(result.total).toBe(2);
    expect(result.items[0]).toMatchObject({
      title: 'a',
      extension: 'md',
      indexed: false,
      chunkCount: 0,
      readability: 'text',
    });
    expect(result.nextCursor).toBeUndefined();
  });

  it('attaches index state per document without gating the list', async () => {
    const folder = await makeFolder({ 'a.md': '# A', 'b.md': '# B' });
    const runtime = runtimeFor(folder, {
      isIndexed: async () => true,
      listDocuments: async () => [
        {
          relativePath: 'a.md',
          chunkCount: 4,
          sizeBytes: 4,
          language: 'markdown',
        } as never,
      ],
    });

    const result = await listKnowledgeDocuments(runtime, {
      baseId: 'folder:0123456789abcdef',
    });

    expect(result.items.find((item) => item.relativePath === 'a.md')).toMatchObject({
      indexed: true,
      chunkCount: 4,
    });
    expect(result.items.find((item) => item.relativePath === 'b.md')).toMatchObject({
      indexed: false,
      chunkCount: 0,
    });
  });

  it('keeps listing when the index itself is unreadable', async () => {
    const folder = await makeFolder({ 'a.md': '# A' });
    const result = await listKnowledgeDocuments(runtimeFor(folder, 'throws'), {
      baseId: 'folder:0123456789abcdef',
    });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.indexed).toBe(false);
  });

  it('pages by cursor and reports the filtered total', async () => {
    const files: Record<string, string> = {};
    for (const name of ['a.md', 'b.md', 'c.md', 'd.md']) files[name] = name;
    const folder = await makeFolder(files);

    const first = await listKnowledgeDocuments(runtimeFor(folder), {
      baseId: 'folder:0123456789abcdef',
      limit: 2,
    });
    expect(first.items.map((item) => item.relativePath)).toEqual(['a.md', 'b.md']);
    expect(first.total).toBe(4);
    expect(first.nextCursor).toBe('b.md');

    const second = await listKnowledgeDocuments(runtimeFor(folder), {
      baseId: 'folder:0123456789abcdef',
      limit: 2,
      ...(first.nextCursor !== undefined ? { cursor: first.nextCursor } : {}),
    });
    expect(second.items.map((item) => item.relativePath)).toEqual(['c.md', 'd.md']);
    expect(second.nextCursor).toBeUndefined();
  });

  it('filters by path substring before paging', async () => {
    const folder = await makeFolder({ 'notes/a.md': 'a', 'notes/b.md': 'b', 'x.md': 'x' });
    const result = await listKnowledgeDocuments(runtimeFor(folder), {
      baseId: 'folder:0123456789abcdef',
      query: 'notes/',
    });
    expect(result.items.map((item) => item.relativePath)).toEqual(['notes/a.md', 'notes/b.md']);
    expect(result.total).toBe(2);
  });

  it('rejects an unknown base instead of listing something else', async () => {
    const folder = await makeFolder({ 'a.md': 'a' });
    await expect(
      listKnowledgeDocuments(runtimeFor(folder), { baseId: 'folder:ffffffffffffffff' }),
    ).rejects.toBeInstanceOf(KnowledgeDocumentError);
  });
});

describe('readKnowledgeDocument', () => {
  it('returns a bounded window with the real line totals', async () => {
    const body = Array.from({ length: 30 }, (_, index) => `line ${index + 1}`).join('\n');
    const folder = await makeFolder({ 'long.md': body });

    const first = await readKnowledgeDocument(runtimeFor(folder), {
      baseId: 'folder:0123456789abcdef',
      relativePath: 'long.md',
      startLine: 1,
      maxLines: 10,
    });

    expect(first.startLine).toBe(1);
    expect(first.endLine).toBe(10);
    expect(first.totalLines).toBe(30);
    expect(first.hasMore).toBe(true);
    expect(first.text.split('\n')).toHaveLength(10);
    expect(first.text.startsWith('line 1\n')).toBe(true);

    const last = await readKnowledgeDocument(runtimeFor(folder), {
      baseId: 'folder:0123456789abcdef',
      relativePath: 'long.md',
      startLine: 21,
      maxLines: 10,
    });
    expect(last.endLine).toBe(30);
    expect(last.hasMore).toBe(false);
  });

  it('reads without an index, so registering a folder is enough', async () => {
    const folder = await makeFolder({ 'draft.md': '# 草稿\n\n未入库也能读。' });
    const result = await readKnowledgeDocument(runtimeFor(folder, 'throws'), {
      baseId: 'folder:0123456789abcdef',
      relativePath: 'draft.md',
    });
    expect(result.text).toContain('未入库也能读。');
    expect(result.indexed).toBe(false);
    expect(result.totalLines).toBe(3);
  });

  it('refuses a path outside the folder', async () => {
    const folder = await makeFolder({ 'a.md': 'a' });
    await expect(
      readKnowledgeDocument(runtimeFor(folder), {
        baseId: 'folder:0123456789abcdef',
        relativePath: '../etc/passwd',
      }),
    ).rejects.toBeInstanceOf(KnowledgePathEscapeError);
  });

  it('refuses formats it cannot read as text instead of returning binary noise', async () => {
    const folder = await makeFolder({ 'scan.pdf': '%PDF-1.4 binary' });
    await expect(
      readKnowledgeDocument(runtimeFor(folder), {
        baseId: 'folder:0123456789abcdef',
        relativePath: 'scan.pdf',
      }),
    ).rejects.toBeInstanceOf(KnowledgeDocumentError);
  });

  it('reports a missing file as missing', async () => {
    const folder = await makeFolder({ 'a.md': 'a' });
    await expect(
      readKnowledgeDocument(runtimeFor(folder), {
        baseId: 'folder:0123456789abcdef',
        relativePath: 'gone.md',
      }),
    ).rejects.toBeInstanceOf(KnowledgeDocumentError);
  });
});
