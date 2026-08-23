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

  it('skips build artifact directories like target and dist-host', async () => {
    await mkdir(join(sourceFolder, 'target', 'debug'), { recursive: true });
    await mkdir(join(sourceFolder, 'dist-host'), { recursive: true });
    await mkdir(join(sourceFolder, 'playwright-report'), { recursive: true });
    await writeFile(join(sourceFolder, 'target', 'debug', 'x.ts'), 'export const x = 1;');
    await writeFile(join(sourceFolder, 'dist-host', 'host.mjs'), 'export {};');
    await writeFile(join(sourceFolder, 'playwright-report', 'trace.js'), 'export {};');
    await writeFile(join(sourceFolder, 'notes.md'), '# Notes');
    const rag = createFolderRag({ piwinRoot });
    const result = await rag.scanFolder(sourceFolder);
    expect(result.files.map((f) => f.relativePath)).toEqual(['notes.md']);
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
    const pack = await rag.retrievePack(sourceFolder, 'spaced repetition forgetting');
    expect(pack.sources[0]?.chunkId).toBeTruthy();
    expect(pack.sources[0]?.relativePath).toBe('srs.md');
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

  it('skips secret-like filenames', async () => {
    await writeFile(join(sourceFolder, '.env'), 'SECRET=1');
    await writeFile(join(sourceFolder, 'id_rsa'), '-----BEGIN');
    await writeFile(join(sourceFolder, 'credentials.json'), '{"token":"x"}');
    await writeFile(join(sourceFolder, 'ok.md'), '# Ok');
    const rag = createFolderRag({ piwinRoot });
    const result = await rag.scanFolder(sourceFolder);
    expect(result.files.map((file) => file.relativePath)).toEqual(['ok.md']);
    rag.close();
  });

  it('does not walk past depth limit', async () => {
    // Root is depth 0; depth 12 is the last included level (DEFAULT_MAX_WALK_DEPTH).
    let current = sourceFolder;
    for (let level = 1; level <= 13; level += 1) {
      current = join(current, `d${level}`);
      await mkdir(current);
      await writeFile(join(current, 'note.md'), `# L${level}`);
    }
    const rag = createFolderRag({ piwinRoot });
    const result = await rag.scanFolder(sourceFolder);
    const paths = result.files.map((file) => file.relativePath).sort();
    expect(paths).toContain('d1/note.md');
    expect(paths).toContain('d1/d2/d3/d4/d5/d6/d7/d8/d9/d10/d11/d12/note.md');
    expect(paths).not.toContain('d1/d2/d3/d4/d5/d6/d7/d8/d9/d10/d11/d12/d13/note.md');
    rag.close();
  });

  it('scan lists pdf as unsupported when MinerU is not configured', async () => {
    await writeFile(join(sourceFolder, 'a.pdf'), 'binary');
    await writeFile(join(sourceFolder, 'a.md'), '# A');
    const rag = createFolderRag({ piwinRoot });
    const result = await rag.scanFolder(sourceFolder);
    expect(result.files.map((file) => file.relativePath)).toEqual(['a.md']);
    expect(result.unsupported).toEqual([
      expect.objectContaining({
        relativePath: 'a.pdf',
        support: 'unsupported',
        unsupportedReason: 'MINERU_NOT_CONFIGURED',
      }),
    ]);
    rag.close();
  });
});
