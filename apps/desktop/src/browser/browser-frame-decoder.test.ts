import { describe, expect, it } from 'vitest';
import {
  BROWSER_FRAME_BINARY_MIME,
  BROWSER_FRAME_BINARY_VERSION,
  type BrowserFramePush,
} from '@piwin/contracts';
import { encodeBrowserFrameBinary } from '@piwin/host-transport';
import {
  createBrowserFrameDecoder,
  validateInlineJpegDataUrl,
  type BrowserFrameErrorReason,
  type BrowserFrameView,
} from './browser-frame-decoder';

const INLINE = 'data:image/jpeg;base64,/9j/4AAQ';

function push(overrides: Partial<BrowserFramePush> = {}): BrowserFramePush {
  return {
    type: 'browser/frame',
    ts: 1,
    frameId: '1',
    width: 1280,
    height: 800,
    encodedWidth: 2560,
    encodedHeight: 1600,
    sourceDpr: 2,
    quality: 80,
    producer: 'screencast',
    byteLength: 4,
    generation: 1,
    pageId: 'page-1',
    documentRevision: 0,
    payload: { kind: 'inline', dataUrl: INLINE },
    ...overrides,
  };
}

function decoder() {
  const ready: BrowserFrameView[] = [];
  const errors: BrowserFrameErrorReason[] = [];
  const objectUrls: string[] = [];
  const revoked: string[] = [];
  let clock = 0;
  const timers = new Map<number, () => void>();
  let timerSeq = 0;
  const handle = createBrowserFrameDecoder({
    onReady: (view) => ready.push(view),
    onError: (reason) => errors.push(reason),
    now: () => clock,
    timeoutMs: 2_000,
    decode: async () => undefined,
    createObjectUrl: (blob) => {
      const url = `blob:test/${String(objectUrls.length)}/${String(blob.size)}`;
      objectUrls.push(url);
      return url;
    },
    revokeObjectUrl: (url) => revoked.push(url),
    schedule: (callback) => {
      timerSeq += 1;
      timers.set(timerSeq, callback);
      return timerSeq;
    },
    cancel: (id) => {
      timers.delete(id);
    },
  });
  return {
    handle,
    ready,
    errors,
    objectUrls,
    revoked,
    flushTimeout() {
      clock += 2_000;
      for (const callback of [...timers.values()]) callback();
      timers.clear();
    },
  };
}

describe('validateInlineJpegDataUrl', () => {
  it('accepts a bounded JPEG data URL and rejects redacted or empty payloads', () => {
    expect(validateInlineJpegDataUrl(INLINE, 1024)).toBe(true);
    expect(validateInlineJpegDataUrl('[redacted]', 1024)).toBe(false);
    expect(validateInlineJpegDataUrl('data:image/png;base64,AAAA', 1024)).toBe(false);
    expect(validateInlineJpegDataUrl('data:image/jpeg;base64,', 1024)).toBe(false);
  });
});

describe('createBrowserFrameDecoder', () => {
  it('replaces the picture only after an inline JPEG validates', async () => {
    const { handle, ready, errors } = decoder();
    handle.ingestPush(push());
    await Promise.resolve();
    expect(errors).toEqual([]);
    expect(ready).toHaveLength(1);
    expect(ready[0]?.src).toBe(INLINE);
    expect(ready[0]?.viewportWidth).toBe(1280);
  });

  it('keeps the last good frame when a redacted or invalid payload arrives', async () => {
    const { handle, ready, errors } = decoder();
    handle.ingestPush(push());
    await Promise.resolve();
    handle.ingestPush(push({ frameId: '2', payload: { kind: 'inline', dataUrl: '[redacted]' } }));
    await Promise.resolve();
    expect(errors).toContain('redacted');
    expect(ready).toHaveLength(1);
  });

  it('pairs binary metadata with the JPEG envelope and revokes the previous object URL', async () => {
    const { handle, ready, objectUrls, revoked } = decoder();
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    handle.ingestPush(
      push({
        frameId: '3',
        payload: { kind: 'binary' },
        byteLength: jpeg.byteLength,
      }),
    );
    handle.ingestBinary(
      encodeBrowserFrameBinary(
        {
          version: BROWSER_FRAME_BINARY_VERSION,
          frameId: '3',
          generation: 1,
          pageId: 'page-1',
          documentRevision: 0,
          width: 1280,
          height: 800,
          encodedWidth: 2560,
          encodedHeight: 1600,
          byteLength: jpeg.byteLength,
          mime: BROWSER_FRAME_BINARY_MIME,
        },
        jpeg,
      ),
    );
    await Promise.resolve();
    expect(ready).toHaveLength(1);
    expect(ready[0]?.src).toBe(objectUrls[0]);

    handle.ingestPush(
      push({
        frameId: '4',
        payload: { kind: 'binary' },
        byteLength: jpeg.byteLength,
      }),
    );
    handle.ingestBinary(
      encodeBrowserFrameBinary(
        {
          version: BROWSER_FRAME_BINARY_VERSION,
          frameId: '4',
          generation: 1,
          pageId: 'page-1',
          documentRevision: 0,
          width: 1280,
          height: 800,
          encodedWidth: 2560,
          encodedHeight: 1600,
          byteLength: jpeg.byteLength,
          mime: BROWSER_FRAME_BINARY_MIME,
        },
        jpeg,
      ),
    );
    await Promise.resolve();
    expect(ready).toHaveLength(2);
    expect(revoked).toContain(objectUrls[0]);
  });

  it('times out unpaired metadata and ignores a late payload for that frame', async () => {
    const { handle, ready, errors, flushTimeout } = decoder();
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    handle.ingestPush(push({ frameId: '9', payload: { kind: 'binary' } }));
    flushTimeout();
    expect(errors).toEqual(['payload-timeout']);
    handle.ingestBinary(
      encodeBrowserFrameBinary(
        {
          version: BROWSER_FRAME_BINARY_VERSION,
          frameId: '9',
          generation: 1,
          pageId: 'page-1',
          documentRevision: 0,
          width: 1280,
          height: 800,
          encodedWidth: 2560,
          encodedHeight: 1600,
          byteLength: jpeg.byteLength,
          mime: BROWSER_FRAME_BINARY_MIME,
        },
        jpeg,
      ),
    );
    await Promise.resolve();
    expect(ready).toHaveLength(0);
  });

  it('surfaces an explicit unavailable reason instead of a broken image', () => {
    const { handle, ready, errors } = decoder();
    handle.ingestPush(
      push({
        payload: { kind: 'unavailable', reason: 'client-update-required' },
      }),
    );
    expect(errors).toEqual(['client-update-required']);
    expect(ready).toHaveLength(0);
  });
});
