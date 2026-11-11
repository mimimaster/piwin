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

const INLINE = 'data:image/jpeg;base64,/9j/2Q==';

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

function decoder(
  sessionId?: string,
  decode: (src: string, signal: AbortSignal) => Promise<void> = async () => undefined,
) {
  const ready: BrowserFrameView[] = [];
  const errors: BrowserFrameErrorReason[] = [];
  const objectUrls: string[] = [];
  const revoked: string[] = [];
  const timers = new Map<number, () => void>();
  let timerSeq = 0;
  const handle = createBrowserFrameDecoder({
    ...(sessionId === undefined ? {} : { sessionId }),
    onReady: (view) => ready.push(view),
    onError: (reason) => errors.push(reason),
    timeoutMs: 2_000,
    decode,
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
  it('never pairs another conversation pixels with a matching local frame id', async () => {
    const { handle, ready, errors } = decoder('session-a');
    const meta = push({ sessionId: 'session-a', payload: { kind: 'binary' } });
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    const header = {
      version: BROWSER_FRAME_BINARY_VERSION, sessionId: 'session-b', frameId: meta.frameId,
      generation: meta.generation, pageId: meta.pageId, documentRevision: 0,
      width: meta.width, height: meta.height, encodedWidth: meta.encodedWidth,
      encodedHeight: meta.encodedHeight, byteLength: bytes.length, mime: BROWSER_FRAME_BINARY_MIME,
    };
    handle.ingestPush(push({ sessionId: 'session-b' }));
    handle.ingestPush(push());
    handle.ingestPush(meta);
    handle.ingestBinary(encodeBrowserFrameBinary(header, bytes));
    await Promise.resolve();
    expect(ready).toHaveLength(0);
    handle.ingestBinary(encodeBrowserFrameBinary({ ...header, sessionId: 'session-a' }, bytes));
    await Promise.resolve();
    expect(ready).toHaveLength(1);
    expect(errors).toEqual([]);
    handle.dispose();
  });

  it('replaces the picture only after an inline JPEG validates', async () => {
    const { handle, ready, errors } = decoder();
    handle.ingestPush(push());
    await Promise.resolve();
    expect(errors).toEqual([]);
    expect(ready).toHaveLength(1);
    expect(ready[0]?.src).toMatch(/^blob:test\//);
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

  it('keeps only one pending encoded frame while a decode is slow', async () => {
    const completions: Array<() => void> = [];
    const { handle, ready, objectUrls, revoked } = decoder(
      undefined,
      () => new Promise<void>((resolve) => completions.push(resolve)),
    );
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);

    for (let frameNumber = 1; frameNumber <= 100; frameNumber += 1) {
      const frame = push({
        frameId: String(frameNumber),
        payload: { kind: 'binary' },
        byteLength: jpeg.byteLength,
      });
      handle.ingestPush(frame);
      handle.ingestBinary(encodeBrowserFrameBinary({
        version: BROWSER_FRAME_BINARY_VERSION,
        frameId: frame.frameId,
        generation: frame.generation,
        pageId: frame.pageId,
        documentRevision: frame.documentRevision,
        width: frame.width,
        height: frame.height,
        encodedWidth: frame.encodedWidth,
        encodedHeight: frame.encodedHeight,
        byteLength: jpeg.byteLength,
        mime: BROWSER_FRAME_BINARY_MIME,
      }, jpeg));
    }

    expect(completions).toHaveLength(1);
    expect(objectUrls).toHaveLength(1);
    completions[0]?.();
    await Promise.resolve();
    expect(completions).toHaveLength(2);
    expect(ready.map((frame) => frame.frameId)).toEqual(['1']);
    completions[1]?.();
    await Promise.resolve();
    expect(ready.map((frame) => frame.frameId)).toEqual(['1', '100']);
    expect(objectUrls).toHaveLength(2);
    expect(revoked).toHaveLength(1);
    handle.dispose();
    expect(revoked).toHaveLength(2);
  });

  it('does not let an older arrival replace the newest pending frame', async () => {
    const completions: Array<() => void> = [];
    const { handle, ready } = decoder(
      undefined,
      () => new Promise<void>((resolve) => completions.push(resolve)),
    );
    handle.ingestPush(push({ frameId: '1' }));
    handle.ingestPush(push({ frameId: '100' }));
    handle.ingestPush(push({ frameId: '2' }));

    completions[0]?.();
    await Promise.resolve();
    expect(ready.map((frame) => frame.frameId)).toEqual(['1']);
    expect(completions).toHaveLength(2);
    completions[1]?.();
    await Promise.resolve();
    expect(ready.map((frame) => frame.frameId)).toEqual(['1', '100']);
    handle.dispose();
  });

  it('decodes self-contained native packets without waiting for control metadata', async () => {
    const { handle, ready, errors } = decoder('session-a');
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    handle.setTarget({ generation: 2, pageId: 'native-page', documentRevision: 3 });
    handle.ingestNativePacket(encodeBrowserFrameBinary({
      version: BROWSER_FRAME_BINARY_VERSION,
      mime: BROWSER_FRAME_BINARY_MIME,
      sessionId: 'session-a', frameId: '4', generation: 2, pageId: 'native-page',
      documentRevision: 3, width: 1280, height: 800, encodedWidth: 2560,
      encodedHeight: 1600, byteLength: jpeg.byteLength,
      presentation: { ts: 1, sourceDpr: 2, quality: 80, producer: 'screencast' },
    }, jpeg));
    await Promise.resolve();
    expect(ready.map((frame) => [frame.frameId, frame.sourceDpr, frame.quality]))
      .toEqual([['4', 2, 80]]);
    expect(errors).toEqual([]);
    handle.dispose();
  });

  it('releases a decoding candidate immediately on reset and rejects its late result', async () => {
    const completions: Array<() => void> = [];
    const { handle, ready, objectUrls, revoked } = decoder(
      undefined,
      () => new Promise<void>((resolve) => completions.push(resolve)),
    );
    handle.ingestPush(push());
    expect(objectUrls).toHaveLength(1);
    handle.reset();
    expect(revoked).toHaveLength(1);

    handle.ingestPush(push({ frameId: '2' }));
    expect(objectUrls).toHaveLength(1);
    completions[0]?.();
    await Promise.resolve();
    expect(ready).toHaveLength(0);
    expect(completions).toHaveLength(2);
    completions[1]?.();
    await Promise.resolve();
    expect(ready.map((frame) => frame.frameId)).toEqual(['2']);
    handle.dispose();
    expect(revoked).toHaveLength(2);
  });

  it('rejects bytes from a different generation even when frameId collides', async () => {
    const { handle, ready } = decoder('session-a');
    handle.setTarget({ generation: 2, pageId: 'page-current', documentRevision: 5 });
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    handle.ingestBinary(encodeBrowserFrameBinary({
      version: BROWSER_FRAME_BINARY_VERSION,
      sessionId: 'session-a',
      frameId: '1',
      generation: 1,
      pageId: 'page-old',
      documentRevision: 1,
      width: 1280,
      height: 800,
      encodedWidth: 2560,
      encodedHeight: 1600,
      byteLength: jpeg.byteLength,
      mime: BROWSER_FRAME_BINARY_MIME,
    }, jpeg));
    handle.ingestPush(push({
      sessionId: 'session-a',
      generation: 2,
      pageId: 'page-current',
      documentRevision: 5,
      frameId: '1',
      payload: { kind: 'binary' },
    }));
    await Promise.resolve();
    expect(ready).toHaveLength(0);
    handle.dispose();
  });
});
