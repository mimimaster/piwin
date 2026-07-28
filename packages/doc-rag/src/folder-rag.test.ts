import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFolderRag } from './folder-rag.js';

let piwinRoot: string;
let sourceFolder: string;

beforeEach(async () => {
  piwinRoot = await mkdtemp(join(tmpdir(), 'piwin-rag-root-'));
  sourceFolder = await mkdtemp(join(tmpdir(), 'piwin-rag-src-'));
});

afterEach(async () => {
  await rm(piwinRoot, { recursive: true, force: true });
  await rm(sourceFolder, { recursive: true, force: true });
});

describe('folder-rag', () => {
  it('scanFolder lists supported files with relative paths', async () => {
    await mkdir(join(sourceFolder, 'sub'), { recursive: true });
    await writeFile(join(sourceFolder, 'a.md'), '# A\n\nText A.');
    await writeFile(join(sourceFolder, 'sub', 'b.ts'), 'export const b = 1;');
    await writeFile(join(sourceFolder, 'c.pdf'), 'binary'); // unsupported
    const rag = createFolderRag({ piwinRoot });
    const result = await rag.scanFolder(sourceFolder);
    expect(result.files.map((f) => f.relativePath).sort()).toEqual(['a.md', 'sub/b.ts']);
    expect(result.supportedExtensions.length).toBeGreaterThan(0);
    rag.close();
  });

  it('skips node_modules and hidden files', async () => {
    await mkdir(join(sourceFolder, 'node_modules'), { recursive: true });
    await mkdir(join(sourceFolder, '.git'), { recursive: true });
    await writeFile(join(sourceFolder, 'node_modules', 'dep.ts'), 'x');
    await writeFile(join(sourceFolder, '.git', 'config.ts'), 'x');
    await writeFile(join(sourceFolder, 'visible.md'), '# Visible');
    const rag = createFolderRag({ piwinRoot });
    const result = await rag.scanFolder(sourceFolder);
    expect(result.files.map((f) => f.relativePath)).toEqual(['visible.md']);
    rag.close();
  });

  it('indexFolder then retrieve returns relevant chunks (FTS-only)', async () => {
    await writeFile(
      join(sourceFolder, 'srs.md'),
      '# Spaced Repetition\n\nSpaced repetition schedules reviews to combat forgetting.\n',
    );
    await writeFile(
      join(sourceFolder, 'cooking.md'),
      '# Cooking\n\nHow to make pasta from scratch.\n',
    );
    const rag = createFolderRag({ piwinRoot });
    const indexResult = await rag.indexFolder(sourceFolder);
    expect(indexResult.indexed).toBe(2);
    expect(indexResult.chunks).toBeGreaterThan(0);
    expect(indexResult.degraded).toBe(true); // no embedding provider

    const hits = await rag.retrieve(sourceFolder, 'spaced repetition forgetting');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]?.filePath).toBe('srs.md');
    expect(hits[0]?.content).toContain('Spaced repetition');
    rag.close();
  });

  it('retrieve with fileAllowlist restricts to listed files', async () => {
    await writeFile(join(sourceFolder, 'a.md'), '# Alpha topic\n\nAlpha content here.');
    await writeFile(join(sourceFolder, 'b.md'), '# Beta topic\n\nBeta content here.');
    const rag = createFolderRag({ piwinRoot });
    await rag.indexFolder(sourceFolder);
    const hits = await rag.retrieve(sourceFolder, 'alpha', {
      fileAllowlist: ['a.md'],
    });
    expect(hits.every((h) => h.filePath === 'a.md')).toBe(true);
    rag.close();
  });

  it('retrieve rejects fileAllowlist entries outside folder', async () => {
    await writeFile(join(sourceFolder, 'a.md'), '# A\n\nContent.');
    const rag = createFolderRag({ piwinRoot });
    await rag.indexFolder(sourceFolder);
    await expect(
      rag.retrieve(sourceFolder, 'a', { fileAllowlist: ['../escape.md'] }),
    ).rejects.toThrow();
    rag.close();
  });

  it('isIndexed reflects index sidecar presence', async () => {
    await writeFile(join(sourceFolder, 'a.md'), '# A\n\nContent.');
    const rag = createFolderRag({ piwinRoot });
    expect(await rag.isIndexed(sourceFolder)).toBe(false);
    await rag.indexFolder(sourceFolder);
    expect(await rag.isIndexed(sourceFolder)).toBe(true);
    rag.close();
  });

  it('scanFolder throws for missing folder', async () => {
    const rag = createFolderRag({ piwinRoot });
    await expect(rag.scanFolder(join(sourceFolder, 'nope'))).rejects.toThrow('not found');
    rag.close();
  });
});
