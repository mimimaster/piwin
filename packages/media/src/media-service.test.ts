import { mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { assertInsideMediaRoot, readMediaAsset, saveMediaAsset } from './media-service.js';
import { UnsafeAttachmentError } from './attachment-policy.js';
import { extractAttachmentText, formatAttachmentTextInjection } from './document-extractor.js';

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

  it('rejects symlinked session dir that escapes media root', async () => {
    const mediaRoot = await mkdtemp(join(tmpdir(), 'piwin-media-'));
    // Attacker pre-creates a symlinked session dir pointing outside.
    const targetOutside = await mkdtemp(join(tmpdir(), 'piwin-escape-'));
    const symlinkedSession = join(mediaRoot, 'sess-evil');
    await symlink(targetOutside, symlinkedSession);
    await expect(
      saveMediaAsset(
        {
          mediaRoot,
          maxPasteBytes: 1024,
          allowedMimeTypes: ['image/png'],
        },
        {
          sessionId: 'sess-evil',
          bytes: new Uint8Array([137, 80, 78, 71, 0, 1, 2, 3]),
          mimeType: 'image/png',
          source: 'paste',
        },
      ),
    ).rejects.toThrow(/escapes media root/);
    // Verify no file was written to the escape target.
    const escapeContents = await readdir(targetOutside);
    expect(escapeContents.length).toBe(0);
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

  it('saves text attachments with their display name and content kind', async () => {
    const mediaRoot = await mkdtemp(join(tmpdir(), 'piwin-media-text-'));
    const asset = await saveMediaAsset(
      {
        mediaRoot,
        maxPasteBytes: 1024,
        allowedMimeTypes: ['text/*'],
      },
      {
        sessionId: 'sess-1',
        bytes: new TextEncoder().encode('const answer = 42;'),
        mimeType: 'text/x-typescript',
        name: 'answer.ts',
        source: 'file-picker',
      },
    );
    expect(asset.name).toBe('answer.ts');
    expect(asset.contentKind).toBe('text');
    expect(asset.absolutePath.endsWith('.ts')).toBe(true);
  });

  it('blocks obvious credential attachments before writing them', async () => {
    const mediaRoot = await mkdtemp(join(tmpdir(), 'piwin-media-secret-'));
    await expect(
      saveMediaAsset(
        {
          mediaRoot,
          maxPasteBytes: 1024,
          allowedMimeTypes: ['text/*'],
        },
        {
          sessionId: 'sess-1',
          bytes: new TextEncoder().encode('AWS_ACCESS_KEY_ID=AKIA1234567890ABCDEF'),
          mimeType: 'text/plain',
          name: '.env',
          source: 'file-picker',
        },
      ),
    ).rejects.toBeInstanceOf(UnsafeAttachmentError);
  });

  it('extracts bounded text and PDF page text for prompt preparation', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-media-extract-'));
    try {
      const textPath = join(rootDir, 'notes.md');
      await writeFile(textPath, '# Notes\n\nKeep this bounded.', 'utf8');
      const text = await extractAttachmentText(textPath, 'text/markdown');
      expect(text.text).toContain('Keep this bounded.');
      expect(formatAttachmentTextInjection(text)).toContain('[attached file: notes.md]');

      const pdfPath = join(rootDir, 'report.pdf');
      await writeFile(pdfPath, createSinglePagePdf('Hello PDF'));
      const pdf = await extractAttachmentText(pdfPath, 'application/pdf');
      expect(pdf.pageCount).toBe(1);
      expect(pdf.text).toContain('Hello PDF');
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });
});

function createSinglePagePdf(text: string): Uint8Array {
  const newline = String.fromCharCode(10);
  const content = `BT /F1 18 Tf 72 200 Td (${text}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(content)} >>${newline}stream${newline}${content}${newline}endstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = `%PDF-1.4${newline}`;
  const offsets = [0];
  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj${newline}${objects[index]}${newline}endobj${newline}`;
  }
  const xrefOffset = Buffer.byteLength(pdf);
  pdf += `xref${newline}0 ${objects.length + 1}${newline}0000000000 65535 f ${newline}`;
  for (let index = 1; index < offsets.length; index += 1) {
    pdf += `${String(offsets[index]).padStart(10, '0')} 00000 n ${newline}`;
  }
  pdf += `trailer${newline}<< /Size ${objects.length + 1} /Root 1 0 R >>${newline}startxref${newline}${xrefOffset}${newline}%%EOF${newline}`;
  return new TextEncoder().encode(pdf);
}

describe('readMediaAsset', () => {
  it('reads a saved asset back by logical id with inferred mime', async () => {
    const mediaRoot = await mkdtemp(join(tmpdir(), 'piwin-media-'));
    const bytes = new Uint8Array([137, 80, 78, 71, 4, 5, 6, 7]);
    const asset = await saveMediaAsset(
      { mediaRoot, maxPasteBytes: 1024, allowedMimeTypes: ['image/png'] },
      { sessionId: 'sess-1', bytes, mimeType: 'image/png', source: 'generated' },
    );
    const result = await readMediaAsset(
      { mediaRoot },
      { sessionId: 'sess-1', assetId: asset.id, maxBytes: 1024 },
    );
    expect(result.status).toBe('ready');
    if (result.status === 'ready') {
      expect(result.bytes.byteLength).toBe(bytes.byteLength);
      expect(result.mimeType).toBe('image/png');
      expect(result.assetId).toBe(asset.id);
      expect(result.sessionId).toBe('sess-1');
    }
  });

  it('returns not-found for unknown assets and missing sessions', async () => {
    const mediaRoot = await mkdtemp(join(tmpdir(), 'piwin-media-'));
    await saveMediaAsset(
      { mediaRoot, maxPasteBytes: 1024, allowedMimeTypes: ['image/png'] },
      {
        sessionId: 'sess-1',
        bytes: new Uint8Array([1, 2, 3]),
        mimeType: 'image/png',
        source: 'paste',
      },
    );
    expect(
      (await readMediaAsset({ mediaRoot }, { sessionId: 'sess-1', assetId: 'nope', maxBytes: 100 }))
        .status,
    ).toBe('unavailable');
    expect(
      (await readMediaAsset({ mediaRoot }, { sessionId: 'ghost', assetId: 'x', maxBytes: 100 }))
        .status,
    ).toBe('unavailable');
  });

  it('rejects traversal session ids and invalid caps', async () => {
    const mediaRoot = await mkdtemp(join(tmpdir(), 'piwin-media-'));
    const traversal = await readMediaAsset(
      { mediaRoot },
      { sessionId: '..', assetId: 'x', maxBytes: 100 },
    );
    expect(traversal).toMatchObject({ status: 'unavailable', reason: 'outside-media-root' });
    const badCap = await readMediaAsset(
      { mediaRoot },
      { sessionId: 'sess-1', assetId: 'x', maxBytes: 0 },
    );
    expect(badCap).toMatchObject({ status: 'unavailable', reason: 'invalid-request' });
  });

  it('rejects assets over the byte cap whole, not truncated', async () => {
    const mediaRoot = await mkdtemp(join(tmpdir(), 'piwin-media-'));
    const asset = await saveMediaAsset(
      { mediaRoot, maxPasteBytes: 4096, allowedMimeTypes: ['image/png'] },
      {
        sessionId: 'sess-1',
        bytes: new Uint8Array(64),
        mimeType: 'image/png',
        source: 'paste',
      },
    );
    const result = await readMediaAsset(
      { mediaRoot },
      { sessionId: 'sess-1', assetId: asset.id, maxBytes: 16 },
    );
    expect(result).toMatchObject({ status: 'unavailable', reason: 'too-large' });
  });

  it('rejects a symlinked vault file that escapes the media root', async () => {
    const mediaRoot = await mkdtemp(join(tmpdir(), 'piwin-media-'));
    const outsideRoot = await mkdtemp(join(tmpdir(), 'piwin-outside-'));
    const outsideFile = join(outsideRoot, 'evil.png');
    await writeFile(outsideFile, new Uint8Array([1, 2, 3]));
    const sessionDir = join(mediaRoot, 'sess-1');
    await (await import('node:fs/promises')).mkdir(sessionDir, { recursive: true });
    await symlink(outsideFile, join(sessionDir, '00000000-0000-0000-0000-000000000000.png'));
    const result = await readMediaAsset(
      { mediaRoot },
      {
        sessionId: 'sess-1',
        assetId: '00000000-0000-0000-0000-000000000000',
        maxBytes: 1024,
      },
    );
    expect(result).toMatchObject({ status: 'unavailable', reason: 'outside-media-root' });
  });
});
