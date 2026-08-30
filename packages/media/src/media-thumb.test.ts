import { access, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import {
  MEDIA_THUMB_MIME,
  mediaThumbFileName,
} from '@piwin/contracts';
import { deleteMediaAsset, saveMediaAsset } from './media-service.js';
import { listMediaLibrary, writeMediaLibraryMeta } from './media-library.js';
import { readMediaThumb } from './media-thumb.js';

async function fixturePng(width = 80, height = 60): Promise<Uint8Array> {
  const buffer = await sharp({
    create: { width, height, channels: 3, background: { r: 30, g: 80, b: 160 } },
  })
    .png()
    .toBuffer();
  return new Uint8Array(buffer);
}

function siblingThumb(absolutePath: string, assetId: string, edge: 256 | 384): string {
  return join(absolutePath, '..', mediaThumbFileName(assetId, edge));
}

describe('media thumbs', () => {
  it('writes 256 and 384 webp sidecars on save and lists the original only', async () => {
    const mediaRoot = await mkdtemp(join(tmpdir(), 'piwin-thumb-save-'));
    const asset = await saveMediaAsset(
      { mediaRoot, maxPasteBytes: 64 * 1024, allowedMimeTypes: ['image/png'] },
      {
        sessionId: 'sess-1',
        bytes: await fixturePng(),
        mimeType: 'image/png',
        source: 'generated',
      },
    );
    await writeMediaLibraryMeta({ mediaRoot }, 'sess-1', asset.id, {
      source: 'generated',
      kind: 'image',
      createdAt: asset.createdAt,
    });

    await access(siblingThumb(asset.absolutePath, asset.id, 256));
    await access(siblingThumb(asset.absolutePath, asset.id, 384));
    const listed = await listMediaLibrary({ mediaRoot }, { kind: 'image' });
    expect(listed.total).toBe(1);
    expect(listed.items[0]?.assetId).toBe(asset.id);
    expect(listed.items[0]?.hasThumb).toBe(true);
    expect(listed.items[0]?.thumbAbsolutePath?.endsWith(mediaThumbFileName(asset.id, 384))).toBe(
      true,
    );
  });

  it('does not list leftover thumb files as their own images', async () => {
    const mediaRoot = await mkdtemp(join(tmpdir(), 'piwin-thumb-skip-'));
    const sessionDir = join(mediaRoot, 'sess-1');
    await mkdir(sessionDir, { recursive: true });
    await writeFile(join(sessionDir, 'orphan.thumb.webp'), new Uint8Array([1, 2, 3]));
    await writeFile(join(sessionDir, 'orphan.thumb.256.webp'), new Uint8Array([1, 2, 3]));
    const listed = await listMediaLibrary({ mediaRoot }, { kind: 'image' });
    expect(listed.total).toBe(0);
  });

  it('reads the requested edge and deletes every sidecar with the original', async () => {
    const mediaRoot = await mkdtemp(join(tmpdir(), 'piwin-thumb-read-'));
    const asset = await saveMediaAsset(
      { mediaRoot, maxPasteBytes: 64 * 1024, allowedMimeTypes: ['image/png'] },
      {
        sessionId: 'sess-1',
        bytes: await fixturePng(800, 600),
        mimeType: 'image/png',
        source: 'generated',
      },
    );
    const dense = await readMediaThumb(
      { mediaRoot },
      { sessionId: 'sess-1', assetId: asset.id, maxBytes: 256 * 1024, thumbEdge: 256 },
    );
    const standard = await readMediaThumb(
      { mediaRoot },
      { sessionId: 'sess-1', assetId: asset.id, maxBytes: 256 * 1024, thumbEdge: 384 },
    );
    expect(dense.status).toBe('ready');
    expect(standard.status).toBe('ready');
    if (dense.status === 'ready') {
      expect(dense.mimeType).toBe(MEDIA_THUMB_MIME);
      const meta = await sharp(dense.bytes).metadata();
      expect(meta.width).toBe(256);
      expect(meta.height).toBe(192);
    }
    if (standard.status === 'ready') {
      const meta = await sharp(standard.bytes).metadata();
      expect(meta.width).toBe(384);
      expect(meta.height).toBe(288);
    }

    expect(await deleteMediaAsset({ mediaRoot }, { sessionId: 'sess-1', assetId: asset.id })).toBe(
      true,
    );
    await expect(access(siblingThumb(asset.absolutePath, asset.id, 256))).rejects.toThrow();
    await expect(access(siblingThumb(asset.absolutePath, asset.id, 384))).rejects.toThrow();
  });

  it('ignores undecodable bytes instead of failing save', async () => {
    const mediaRoot = await mkdtemp(join(tmpdir(), 'piwin-thumb-bad-'));
    const asset = await saveMediaAsset(
      { mediaRoot, maxPasteBytes: 1024, allowedMimeTypes: ['image/png'] },
      {
        sessionId: 'sess-1',
        bytes: new Uint8Array([137, 80, 78, 71, 1]),
        mimeType: 'image/png',
        source: 'paste',
      },
    );
    expect(asset.id).toBeTruthy();
    const listed = await listMediaLibrary({ mediaRoot }, { kind: 'image' });
    expect(listed.total).toBe(0);
  });
});
