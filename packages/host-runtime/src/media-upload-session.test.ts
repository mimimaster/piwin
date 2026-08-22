import { afterEach, describe, expect, it } from 'vitest';
import { MEDIA_SAVE_CHUNK_MAX_BYTES } from '@piwin/contracts';
import {
  abortMediaUpload,
  appendMediaUploadChunk,
  beginMediaUpload,
  concatMediaUpload,
  resetMediaUploads,
  takeMediaUpload,
} from './media-upload-session.js';

describe('media-upload-session', () => {
  afterEach(() => {
    resetMediaUploads();
  });

  it('assembles sequential chunks into the declared payload', () => {
    const first = new Uint8Array([1, 2, 3]);
    const second = new Uint8Array([4, 5]);
    const session = beginMediaUpload({
      sessionId: 's1',
      mimeType: 'image/png',
      source: 'paste',
      byteSize: 5,
      maxPasteBytes: 1024,
    });
    appendMediaUploadChunk({
      uploadId: session.uploadId,
      chunkIndex: 0,
      bytes: first,
      maxPasteBytes: 1024,
    });
    appendMediaUploadChunk({
      uploadId: session.uploadId,
      chunkIndex: 1,
      bytes: second,
      maxPasteBytes: 1024,
    });
    const finished = takeMediaUpload(session.uploadId);
    expect(Array.from(concatMediaUpload(finished))).toEqual([1, 2, 3, 4, 5]);
  });

  it('rejects out-of-order chunks and oversized declarations', () => {
    expect(() =>
      beginMediaUpload({
        sessionId: 's1',
        mimeType: 'image/png',
        source: 'paste',
        byteSize: 2048,
        maxPasteBytes: 1024,
      }),
    ).toThrow(/too large/);

    const session = beginMediaUpload({
      sessionId: 's1',
      mimeType: 'image/png',
      source: 'paste',
      byteSize: 4,
      maxPasteBytes: 1024,
    });
    expect(() =>
      appendMediaUploadChunk({
        uploadId: session.uploadId,
        chunkIndex: 1,
        bytes: new Uint8Array([1]),
        maxPasteBytes: 1024,
      }),
    ).toThrow(/out of order/);
    expect(MEDIA_SAVE_CHUNK_MAX_BYTES).toBe(384 * 1024);
  });

  it('aborts an in-flight upload so finish cannot claim it', () => {
    const session = beginMediaUpload({
      sessionId: 's1',
      mimeType: 'image/png',
      source: 'paste',
      byteSize: 1,
      maxPasteBytes: 1024,
    });
    expect(abortMediaUpload(session.uploadId)).toBe(true);
    expect(() => takeMediaUpload(session.uploadId)).toThrow(/not active/);
  });
});
