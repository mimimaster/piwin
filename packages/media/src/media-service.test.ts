import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { assertInsideMediaRoot, saveMediaAsset } from './media-service.js';

describe('media-service', () => {
  it('saves png under session dir', async () => {
    const mediaRoot = await mkdtemp(join(tmpdir(), 'piwin-media-'));
    const bytes = new Uint8Array([137, 80, 78, 71, 0, 1, 2, 3]);
    const asset = await saveMediaAsset(
      {
        mediaRoot,
        maxPasteBytes: 1024,
        allowedMimeTypes: ['image/png'],
      },
      {
        sessionId: 'sess-1',
        bytes,
        mimeType: 'image/png',
        source: 'paste',
      },
    );
    expect(asset.absolutePath.includes('sess-1')).toBe(true);
    expect(asset.mimeType).toBe('image/png');
    const written = await readFile(asset.absolutePath);
    expect(written.byteLength).toBe(bytes.byteLength);
  });

  it('rejects path traversal', () => {
    expect(() => assertInsideMediaRoot('/tmp/media', '/tmp/other/x.png')).toThrow(
      /escapes media root/,
    );
  });

  it('rejects disallowed mime', async () => {
    const mediaRoot = await mkdtemp(join(tmpdir(), 'piwin-media-'));
    await expect(
      saveMediaAsset(
        {
          mediaRoot,
          maxPasteBytes: 1024,
          allowedMimeTypes: ['image/png'],
        },
        {
          sessionId: 's',
          bytes: new Uint8Array([1]),
          mimeType: 'application/pdf',
          source: 'paste',
        },
      ),
    ).rejects.toThrow(/not allowed/);
  });
});
