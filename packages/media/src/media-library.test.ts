import { mkdtemp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { deleteMediaAsset, saveMediaAsset } from './media-service.js';
import { listMediaLibrary, writeMediaLibraryMeta } from './media-library.js';

describe('listMediaLibrary', () => {
  it('lists image files newest first and skips videos', async () => {
    const mediaRoot = await mkdtemp(join(tmpdir(), 'piwin-media-lib-'));
    const older = await saveMediaAsset(
      { mediaRoot, maxPasteBytes: 1024, allowedMimeTypes: ['image/png', 'video/mp4'] },
      {
        sessionId: 'sess-a',
        bytes: new Uint8Array([137, 80, 78, 71, 1]),
        mimeType: 'image/png',
        source: 'generated',
      },
    );
    await writeMediaLibraryMeta({ mediaRoot }, 'sess-a', older.id, {
      source: 'generated',
      kind: 'image',
      createdAt: '2026-01-01T00:00:00.000Z',
      prompt: 'old lighthouse',
    });
    const newer = await saveMediaAsset(
      { mediaRoot, maxPasteBytes: 1024, allowedMimeTypes: ['image/png', 'video/mp4'] },
      {
        sessionId: 'sess-b',
        bytes: new Uint8Array([137, 80, 78, 71, 2]),
        mimeType: 'image/png',
        source: 'generated',
      },
    );
    await writeMediaLibraryMeta({ mediaRoot }, 'sess-b', newer.id, {
      source: 'generated',
      kind: 'image',
      createdAt: '2026-08-01T00:00:00.000Z',
      prompt: 'neon street',
      model: 'flux',
    });
    const video = await saveMediaAsset(
      { mediaRoot, maxPasteBytes: 4096, allowedMimeTypes: ['image/png', 'video/mp4'] },
      {
        sessionId: 'sess-b',
        bytes: new Uint8Array([0, 0, 0, 28, 102, 116, 121, 112]),
        mimeType: 'video/mp4',
        source: 'generated',
      },
    );
    await writeMediaLibraryMeta({ mediaRoot }, 'sess-b', video.id, {
      source: 'generated',
      kind: 'video',
      createdAt: '2026-08-02T00:00:00.000Z',
    });

    const listed = await listMediaLibrary({ mediaRoot }, { kind: 'image' });
    expect(listed.total).toBe(2);
    expect(listed.items[0]?.assetId).toBe(newer.id);
    expect(listed.items[0]?.prompt).toBe('neon street');
    expect(listed.items[1]?.assetId).toBe(older.id);

    const mixed = await listMediaLibrary({ mediaRoot }, {});
    expect(mixed.total).toBe(3);
    expect(mixed.items.some((item) => item.kind === 'video')).toBe(true);
  });

  it('filters by prompt and paginates with a cursor', async () => {
    const mediaRoot = await mkdtemp(join(tmpdir(), 'piwin-media-lib-page-'));
    const first = await saveMediaAsset(
      { mediaRoot, maxPasteBytes: 1024, allowedMimeTypes: ['image/png'] },
      {
        sessionId: 'sess-1',
        bytes: new Uint8Array([137, 80, 78, 71, 1]),
        mimeType: 'image/png',
        source: 'generated',
      },
    );
    const second = await saveMediaAsset(
      { mediaRoot, maxPasteBytes: 1024, allowedMimeTypes: ['image/png'] },
      {
        sessionId: 'sess-1',
        bytes: new Uint8Array([137, 80, 78, 71, 2]),
        mimeType: 'image/png',
        source: 'generated',
      },
    );
    await writeMediaLibraryMeta({ mediaRoot }, 'sess-1', first.id, {
      source: 'generated',
      kind: 'image',
      createdAt: '2026-02-01T00:00:00.000Z',
      prompt: 'cat',
    });
    await writeMediaLibraryMeta({ mediaRoot }, 'sess-1', second.id, {
      source: 'generated',
      kind: 'image',
      createdAt: '2026-03-01T00:00:00.000Z',
      prompt: 'cat portrait',
    });

    const page = await listMediaLibrary({ mediaRoot }, { kind: 'image', query: 'cat', limit: 1 });
    expect(page.total).toBe(2);
    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.assetId).toBe(second.id);
    expect(page.nextCursor).toBeDefined();

    const next = await listMediaLibrary(
      { mediaRoot },
      {
        kind: 'image',
        query: 'cat',
        limit: 1,
        ...(page.nextCursor ? { cursor: page.nextCursor } : {}),
      },
    );
    expect(next.items[0]?.assetId).toBe(first.id);
    expect(next.nextCursor).toBeUndefined();
  });

  it('hides user paste and file-picker assets from the library', async () => {
    const mediaRoot = await mkdtemp(join(tmpdir(), 'piwin-media-lib-user-'));
    const generated = await saveMediaAsset(
      { mediaRoot, maxPasteBytes: 1024, allowedMimeTypes: ['image/png', 'text/plain'] },
      {
        sessionId: 'sess-1',
        bytes: new Uint8Array([137, 80, 78, 71, 9]),
        mimeType: 'image/png',
        source: 'generated',
      },
    );
    await writeMediaLibraryMeta({ mediaRoot }, 'sess-1', generated.id, {
      source: 'generated',
      kind: 'image',
      createdAt: '2026-08-01T00:00:00.000Z',
      prompt: 'app output',
    });
    const pasted = await saveMediaAsset(
      { mediaRoot, maxPasteBytes: 1024, allowedMimeTypes: ['image/png', 'text/plain'] },
      {
        sessionId: 'sess-1',
        bytes: new Uint8Array([137, 80, 78, 71, 8]),
        mimeType: 'image/png',
        name: 'screenshot.png',
        source: 'paste',
      },
    );
    await writeMediaLibraryMeta({ mediaRoot }, 'sess-1', pasted.id, {
      source: 'paste',
      kind: 'image',
      createdAt: '2026-08-02T00:00:00.000Z',
      name: 'screenshot.png',
    });
    const picked = await saveMediaAsset(
      { mediaRoot, maxPasteBytes: 1024, allowedMimeTypes: ['image/png', 'text/plain'] },
      {
        sessionId: 'sess-1',
        bytes: new Uint8Array([110, 111, 116, 101, 115]),
        mimeType: 'text/plain',
        name: 'research-notes.md',
        source: 'file-picker',
      },
    );
    await writeMediaLibraryMeta({ mediaRoot }, 'sess-1', picked.id, {
      source: 'file-picker',
      kind: 'file',
      createdAt: '2026-08-03T00:00:00.000Z',
      name: 'research-notes.md',
    });

    const images = await listMediaLibrary({ mediaRoot }, { kind: 'image' });
    expect(images.total).toBe(1);
    expect(images.items[0]?.assetId).toBe(generated.id);

    const files = await listMediaLibrary({ mediaRoot }, { kind: 'file' });
    expect(files.total).toBe(0);
  });

  it('does not list vault images without a generated sidecar', async () => {
    const mediaRoot = await mkdtemp(join(tmpdir(), 'piwin-media-lib-legacy-'));
    await saveMediaAsset(
      { mediaRoot, maxPasteBytes: 1024, allowedMimeTypes: ['image/png'] },
      {
        sessionId: 'sess-1',
        bytes: new Uint8Array([137, 80, 78, 71, 7]),
        mimeType: 'image/png',
        source: 'paste',
      },
    );
    const listed = await listMediaLibrary({ mediaRoot }, { kind: 'image' });
    expect(listed.total).toBe(0);
  });

  it('keeps JSON file bytes separate from the metadata sidecar', async () => {
    const mediaRoot = await mkdtemp(join(tmpdir(), 'piwin-media-lib-json-'));
    const asset = await saveMediaAsset(
      { mediaRoot, maxPasteBytes: 1024, allowedMimeTypes: ['application/json'] },
      {
        sessionId: 'sess-json',
        bytes: new TextEncoder().encode('{"enabled":true}'),
        mimeType: 'application/json',
        name: 'settings.json',
        source: 'file-picker',
      },
    );
    await writeMediaLibraryMeta({ mediaRoot }, asset.sessionId, asset.id, {
      source: 'file-picker',
      kind: 'file',
      createdAt: asset.createdAt,
      name: 'settings.json',
    });

    expect(new TextDecoder().decode(await readFile(asset.absolutePath))).toBe('{"enabled":true}');
    expect(await readdir(join(mediaRoot, asset.sessionId))).toEqual(
      expect.arrayContaining([`${asset.id}.json`, `${asset.id}.meta.json`]),
    );
    const listed = await listMediaLibrary({ mediaRoot }, { kind: 'file' });
    expect(listed.total).toBe(0);
    expect(
      await deleteMediaAsset({ mediaRoot }, { sessionId: asset.sessionId, assetId: asset.id }),
    ).toBe(true);
    expect((await listMediaLibrary({ mediaRoot }, { kind: 'file' })).total).toBe(0);
  });

  it('deletes the vault file and sidecar', async () => {
    const mediaRoot = await mkdtemp(join(tmpdir(), 'piwin-media-lib-del-'));
    const asset = await saveMediaAsset(
      { mediaRoot, maxPasteBytes: 1024, allowedMimeTypes: ['image/png'] },
      {
        sessionId: 'sess-1',
        bytes: new Uint8Array([137, 80, 78, 71, 9]),
        mimeType: 'image/png',
        source: 'generated',
      },
    );
    await writeMediaLibraryMeta({ mediaRoot }, 'sess-1', asset.id, {
      source: 'generated',
      kind: 'image',
      createdAt: asset.createdAt,
      prompt: 'gone',
    });
    expect(await deleteMediaAsset({ mediaRoot }, { sessionId: 'sess-1', assetId: asset.id })).toBe(
      true,
    );
    const listed = await listMediaLibrary({ mediaRoot }, { kind: 'image' });
    expect(listed.total).toBe(0);
    expect(await deleteMediaAsset({ mediaRoot }, { sessionId: 'sess-1', assetId: asset.id })).toBe(
      false,
    );
  });

  it('ignores files sitting outside a session directory', async () => {
    const mediaRoot = await mkdtemp(join(tmpdir(), 'piwin-media-lib-skip-'));
    await mkdir(join(mediaRoot, 'sess-1'), { recursive: true });
    await writeFile(join(mediaRoot, 'loose.png'), new Uint8Array([137, 80, 78, 71]));
    const listed = await listMediaLibrary({ mediaRoot }, { kind: 'image' });
    expect(listed.total).toBe(0);
  });
});
