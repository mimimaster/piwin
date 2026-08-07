import { describe, expect, it } from 'vitest';
import {
  fileToBase64,
  isPendingAttachmentReady,
  prepareComposerImageForSave,
  resolveImageMimeType,
  type PendingComposerAttachment,
} from './media-utils';

describe('media-utils', () => {
  it('resolves declared and sniffed image MIME types', () => {
    expect(resolveImageMimeType(new File([], 'x.png', { type: 'image/png' }))).toBe('image/png');
    expect(resolveImageMimeType(new File([], 'x.jpg', { type: 'image/jpg' }))).toBe('image/jpeg');
    expect(resolveImageMimeType(new File([], 'shot', { type: '' }))).toBeNull();

    const pngHeader = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(resolveImageMimeType(new File([], 'shot', { type: '' }), pngHeader)).toBe('image/png');
  });

  it('encodes files as raw base64 without a data-URL prefix', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5, 250]);
    const file = new File([bytes], 'tiny.bin', { type: 'application/octet-stream' });
    const encoded = await fileToBase64(file);
    expect(encoded.includes(',')).toBe(false);
    expect(encoded).toBe(Buffer.from(bytes).toString('base64'));
  });

  it('passes small images through prepareComposerImageForSave unchanged', async () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]);
    const file = new File([bytes], 'tiny.png', { type: 'image/png' });
    const prepared = await prepareComposerImageForSave(file, 'image/png');
    expect(prepared.compressed).toBe(false);
    expect(prepared.mimeType).toBe('image/png');
    expect(prepared.byteSize).toBe(file.size);
  });

  it('leaves animated gifs untouched', async () => {
    const file = new File([new Uint8Array(2_000_000)], 'big.gif', { type: 'image/gif' });
    const prepared = await prepareComposerImageForSave(file, 'image/gif');
    expect(prepared.compressed).toBe(false);
    expect(prepared.mimeType).toBe('image/gif');
    expect(prepared.blob).toBe(file);
  });

  it('treats media chips as ready only after uploadStatus is ready', () => {
    const ready: PendingComposerAttachment = {
      localId: '1',
      previewUrl: 'blob:a',
      uploadStatus: 'ready',
      attachment: {
        id: '1',
        kind: 'media',
        path: '/tmp/.piwin/media/s/a.png',
        mimeType: 'image/png',
        byteSize: 10,
        source: 'paste',
      },
    };
    const saving: PendingComposerAttachment = {
      ...ready,
      localId: '2',
      uploadStatus: 'saving',
    };
    const failed: PendingComposerAttachment = {
      ...ready,
      localId: '3',
      uploadStatus: 'error',
      uploadError: 'boom',
    };
    const web: PendingComposerAttachment = {
      localId: '4',
      previewUrl: '',
      attachment: {
        id: '4',
        kind: 'web-element',
        url: 'https://example.com',
        selector: 'body',
        text: 'hi',
      },
    };

    expect(isPendingAttachmentReady(ready)).toBe(true);
    expect(isPendingAttachmentReady(saving)).toBe(false);
    expect(isPendingAttachmentReady(failed)).toBe(false);
    expect(isPendingAttachmentReady(web)).toBe(true);
  });
});
