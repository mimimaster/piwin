import { mkdtemp, mkdir, readdir, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { importGeneratedMediaAsset } from './generated-media-import.js';
import { listMediaLibrary } from './media-library.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'piwin-backend-media-'));
  roots.push(root);
  const sourceRoot = join(root, 'grok');
  await mkdir(sourceRoot);
  const sourcePath = join(sourceRoot, '1.png');
  await writeFile(sourcePath, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jS1EAAAAASUVORK5CYII=', 'base64'));
  const options = { mediaRoot: join(root, 'media'), maxPasteBytes: 1024, allowedMimeTypes: ['image/png'] };
  const input = { sourceRoot, sourcePath, sessionId: 'product-session', importKey: 'grok:session:images/1.png', kind: 'image' as const, prompt: 'portrait' };
  return { root, options, input };
}

describe('backend generated media import', () => {
  it('saves an owned attachment and library entry, and deduplicates replay', async () => {
    const { options, input } = await fixture();
    const first = await importGeneratedMediaAsset(options, input);
    const repeated = await importGeneratedMediaAsset(options, input);
    expect(repeated.id).toBe(first.id);
    expect(first.absolutePath.startsWith(options.mediaRoot)).toBe(true);
    const library = await listMediaLibrary(options, {});
    expect(library.items).toHaveLength(1);
    expect(library.items[0]).toMatchObject({ assetId: first.id, prompt: 'portrait', kind: 'image' });
  });

  it('reuses the same native file when live and history import keys differ', async () => {
    const { options, input } = await fixture();
    const first = await importGeneratedMediaAsset(options, input);
    const backfilled = await importGeneratedMediaAsset(options, { ...input, importKey: 'host:history:1.png' });
    expect(backfilled.id).toBe(first.id);
    expect((await listMediaLibrary(options, {})).items).toHaveLength(1);
  });

  it('migrates old id-only receipts without duplicating the library asset', async () => {
    const { options, input } = await fixture();
    const first = await importGeneratedMediaAsset(options, input);
    const directory = join(options.mediaRoot, input.sessionId, '.imports');
    const receipt = (await readdir(directory))[0];
    if (receipt === undefined) throw new Error('missing receipt');
    await rename(join(directory, receipt), join(directory, 'legacy.json'));
    await writeFile(join(directory, 'legacy.json'), JSON.stringify({ id: first.id }));
    const restored = await importGeneratedMediaAsset(options, { ...input, importKey: 'host:history:1.png' });
    expect(restored.id).toBe(first.id);
    expect((await listMediaLibrary(options, {})).items).toHaveLength(1);
  });

  it('rejects paths and symlinks outside the backend session root', async () => {
    const { root, options, input } = await fixture();
    const outside = join(root, 'outside.png');
    await writeFile(outside, 'private');
    await expect(importGeneratedMediaAsset(options, { ...input, sourcePath: outside })).rejects.toThrow(/source root/);
    const link = join(input.sourceRoot, 'linked.png');
    await symlink(outside, link);
    await expect(importGeneratedMediaAsset(options, { ...input, sourcePath: link })).rejects.toThrow(/source root/);
  });

  it('rejects oversized files before storing them', async () => {
    const { options, input } = await fixture();
    await writeFile(input.sourcePath, Buffer.alloc(2048));
    await expect(importGeneratedMediaAsset(options, input)).rejects.toThrow(/too large/);
    await expect(readdir(options.mediaRoot)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
