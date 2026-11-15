/** One identity/encoding boundary for local JSON and remote JPEG sinks. */
import { BROWSER_FRAME_BINARY_MIME, BROWSER_FRAME_BINARY_VERSION,
  type BrowserFrameBinaryHeader, type BrowserFramePush } from '@piwin/contracts';
import type { BrowserFrameResult } from './browser-mirror.js';
import { toJpegDataUrl } from './frame-encoding.js';

export function createBrowserFramePublisher(deps: {
  identity: () => { generation: number; pageId: string; documentRevision: number };
  transport: 'inline' | 'binary';
  emit: (event: BrowserFramePush) => void;
  onBytes?: (header: BrowserFrameBinaryHeader, bytes: Uint8Array) => void;
}): (result: BrowserFrameResult) => void {
  let frameSequence = 0;
  let frameGeneration = -1;
  return (result) => {
    const identity = deps.identity();
    if (frameGeneration !== identity.generation) {
      frameGeneration = identity.generation;
      frameSequence = 0;
    }
    frameSequence += 1;
    const frameId = String(frameSequence);
    const dimensions = { width: result.width, height: result.height,
      encodedWidth: result.encodedWidth, encodedHeight: result.encodedHeight,
      byteLength: result.bytes.byteLength };
    deps.emit({ type: 'browser/frame', ts: Date.now(), frameId, ...identity, ...dimensions,
      sourceDpr: result.sourceDpr, quality: result.quality, producer: result.producer,
      payload: deps.transport === 'binary' ? { kind: 'binary' }
        : { kind: 'inline', dataUrl: toJpegDataUrl(result.bytes) } });
    deps.onBytes?.({ version: BROWSER_FRAME_BINARY_VERSION, frameId, ...identity,
      ...dimensions, mime: BROWSER_FRAME_BINARY_MIME }, result.bytes);
  };
}
