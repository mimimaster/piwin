import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { previewLocalFile } from './local-file-preview.js';

const PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
]);

async function setup(): Promise<{ root: string; mediaRoot: string; sessionId: string }> {
  const root = await mkdtemp(join(tmpdir(), 'piwin-preview-file-'));
  return { root, mediaRoot: join(root, 'media'), sessionId: 'session-1' };
}

describe('previewLocalFile', () => {
  it('copies a PNG into the session media vault', async () => {
    const ctx = await setup();
    const source = join(ctx.root, 'ncg-boot2.png');
    await writeFile(source, PNG_BYTES);

    const result = await previewLocalFile({
      absolutePath: source,
      sessionId: ctx.sessionId,
      mediaRoot: ctx.mediaRoot,
      maxImageBytes: 1024,
      allowedMimeTypes: ['image/png'],
    });

    expect(result.status).toBe('ready');
    if (result.status === 'ready') {
      expect(result.kind).toBe('media');
      if (result.kind === 'media') {
        expect(result.asset.mimeType).toBe('image/png');
        expect(result.asset.name).toBe('ncg-boot2.png');
        expect(result.asset.absolutePath).toContain(`/media/${ctx.sessionId}/`);
      }
    }
  });

  it('returns markdown as read-only text', async () => {
    const ctx = await setup();
    const source = join(ctx.root, 'notes.md');
    await writeFile(source, '# hello\n', 'utf8');

    const result = await previewLocalFile({
      absolutePath: source,
      sessionId: ctx.sessionId,
      mediaRoot: ctx.mediaRoot,
      maxImageBytes: 1024,
      allowedMimeTypes: ['image/png'],
    });

    expect(result).toMatchObject({
      status: 'ready',
      kind: 'text',
      content: '# hello\n',
      truncated: false,
      readOnly: true,
    });
  });

  it('shows a misnamed .png as text when the bytes are text', async () => {
    const ctx = await setup();
    const source = join(ctx.root, 'notes.png');
    await writeFile(source, '# still text\n', 'utf8');

    const result = await previewLocalFile({
      absolutePath: source,
      sessionId: ctx.sessionId,
      mediaRoot: ctx.mediaRoot,
      maxImageBytes: 1024,
      allowedMimeTypes: ['image/png'],
    });

    expect(result).toMatchObject({
      status: 'ready',
      kind: 'text',
      content: '# still text\n',
    });
  });

  it('rejects a NUL binary that is not an image', async () => {
    const ctx = await setup();
    const source = join(ctx.root, 'blob.bin');
    await writeFile(source, Buffer.from([0x00, 0x01, 0x02, 0x03]));

    const result = await previewLocalFile({
      absolutePath: source,
      sessionId: ctx.sessionId,
      mediaRoot: ctx.mediaRoot,
      maxImageBytes: 1024,
      allowedMimeTypes: ['image/png'],
    });

    expect(result).toMatchObject({ status: 'unavailable', reason: 'binary' });
  });

  it('rejects a missing file', async () => {
    const ctx = await setup();
    await mkdir(ctx.root, { recursive: true });
    const result = await previewLocalFile({
      absolutePath: join(ctx.root, 'missing.png'),
      sessionId: ctx.sessionId,
      mediaRoot: ctx.mediaRoot,
      maxImageBytes: 1024,
      allowedMimeTypes: ['image/png'],
    });
    expect(result).toMatchObject({ status: 'unavailable', reason: 'not-found' });
  });

  it('expands a leading ~ instead of rejecting the path as non-absolute', async () => {
    const ctx = await setup();
    const result = await previewLocalFile({
      // Reaching the filesystem (not-found) is the assertion: before expansion
      // a `~/...` chip was rejected as invalid-request without any stat.
      absolutePath: '~/__piwin_preview_probe_missing__',
      sessionId: ctx.sessionId,
      mediaRoot: ctx.mediaRoot,
      maxImageBytes: 1024,
      allowedMimeTypes: ['image/png'],
    });
    expect(result).toMatchObject({ status: 'unavailable', reason: 'not-found' });
  });

  it('rejects a relative path', async () => {
    const ctx = await setup();
    const result = await previewLocalFile({
      absolutePath: 'ncg-boot2.png',
      sessionId: ctx.sessionId,
      mediaRoot: ctx.mediaRoot,
      maxImageBytes: 1024,
      allowedMimeTypes: ['image/png'],
    });
    expect(result).toMatchObject({ status: 'unavailable', reason: 'invalid-request' });
  });

  it('rejects an oversized image', async () => {
    const ctx = await setup();
    const source = join(ctx.root, 'big.png');
    await writeFile(source, PNG_BYTES);

    const result = await previewLocalFile({
      absolutePath: source,
      sessionId: ctx.sessionId,
      mediaRoot: ctx.mediaRoot,
      maxImageBytes: 4,
      allowedMimeTypes: ['image/png'],
    });
    expect(result).toMatchObject({ status: 'unavailable', reason: 'too-large' });
  });
});
