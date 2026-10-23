import { describe, expect, it, vi } from 'vitest';
import {
  applyChipPreviewUrl,
  commitLimitedChipPreview,
  COMPOSER_IMAGE_TARGET_MAX_BYTES,
  fileToBase64,
  isHostWireFrameLimitError,
  isPendingAttachmentReady,
  preferCompressedComposerImage,
  prepareComposerImageForSave,
  resolveImageMimeType,
  revokePendingAttachmentUrls,
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

  it('prefers the compressed encode only when it is smaller', () => {
    expect(COMPOSER_IMAGE_TARGET_MAX_BYTES).toBe(2 * 1024 * 1024);
    expect(preferCompressedComposerImage(800_000, 790_000)).toBe(true);
    expect(preferCompressedComposerImage(800_000, 810_000)).toBe(false);
    expect(preferCompressedComposerImage(500_000, 400_000)).toBe(true);
  });

  it('detects Host wire-frame limit errors from media/save encode', () => {
    expect(isHostWireFrameLimitError(new Error('Host wire frame exceeds 1048576 bytes'))).toBe(
      true,
    );
    expect(isHostWireFrameLimitError(new Error('network down'))).toBe(false);
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

  it('revokes preview and lightbox URLs when they differ', () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    revokePendingAttachmentUrls({
      localId: '1',
      previewUrl: 'blob:thumb',
      lightboxUrl: 'blob:full',
      attachment: {
        id: '1',
        kind: 'media',
        path: '/tmp/.piwin/media/s/a.png',
        mimeType: 'image/png',
        byteSize: 10,
        source: 'paste',
      },
    });
    expect(revoke).toHaveBeenCalledWith('blob:thumb');
    expect(revoke).toHaveBeenCalledWith('blob:full');
    revoke.mockRestore();
  });

  it('commits a late chip preview onto live and snapshot lists', () => {
    const live: PendingComposerAttachment[] = [
      {
        localId: 'chip-1',
        previewUrl: '',
        lightboxUrl: 'blob:full',
        uploadStatus: 'queued',
        attachment: {
          id: 'chip-1',
          kind: 'media',
          path: 'pending://chip-1',
          mimeType: 'image/png',
          byteSize: 4,
          source: 'paste',
        },
      },
    ];
    const snapshot = { attachments: [...live] };
    const committed = commitLimitedChipPreview({
      localId: 'chip-1',
      previewUrl: 'blob:thumb',
      cancelled: false,
      live,
      snapshots: [snapshot],
    });
    expect(committed.keep).toBe(true);
    expect(committed.live[0]?.previewUrl).toBe('blob:thumb');
    expect(snapshot.attachments[0]?.previewUrl).toBe('blob:thumb');
    expect(applyChipPreviewUrl(live, 'missing', 'blob:x').found).toBe(false);
  });
});
