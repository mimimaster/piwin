/**
 * Single-producer workbench mirror: public page.screencast with screenshot
 * frame-loop fallback. Does not own Chromium lifetime. A live screencast must
 * not run frameLoop; producer stop/failure degrades to screenshots without
 * relaunching the browser.
 */
import type { Page } from 'playwright-core';
import type { BrowserFrameProducer } from '@piwin/contracts';
import { createFrameLoop, type FrameLoop } from './frames.js';
import { startScreencast, type ScreencastHandle } from './screencast.js';
import {
  BROWSER_SCREENCAST_QUALITY,
  BROWSER_SCREENSHOT_QUALITY,
  resolveBrowserScreencastFps,
  resolveBrowserScreencastSize,
  type BrowserScreencastSize,
} from './screencast-size.js';
import { readJpegSize } from './jpeg-size.js';

/**
 * One captured frame as the mirror produced it. Identity, payload shape and
 * delivery are the session's concern (spec §4.1.2).
 */
export type BrowserFrameResult = {
  bytes: Uint8Array;
  width: number;
  height: number;
  encodedWidth: number;
  encodedHeight: number;
  sourceDpr: number;
  quality: number;
  producer: BrowserFrameProducer;
};

export type BrowserMirrorDeps = {
  maxDimension: number;
  maxFps: number;
  getPage: () => Promise<Page>;
  hasActiveMirrorLease: () => boolean;
  resolveDeviceScaleFactor: (page: Page) => Promise<number>;
  screencastQuality?: number;
  /** Single delivery path for both producers. */
  onFrame: (frame: BrowserFrameResult) => void;
};

export type BrowserMirror = {
  frameLoop: FrameLoop;
  hasScreencast(): boolean;
  startMirrorFrames(activePage: Page): Promise<void>;
  stopScreencast(): Promise<void>;
};

function sameScreencastSize(left: BrowserScreencastSize, right: BrowserScreencastSize): boolean {
  return left.width === right.width && left.height === right.height;
}

export function createBrowserMirror(deps: BrowserMirrorDeps): BrowserMirror {
  let screencastHandle: ScreencastHandle | undefined;
  let liveSize: BrowserScreencastSize | undefined;
  let liveDpr: number | undefined;

  function wantsFallbackFrames(): boolean {
    return screencastHandle === undefined && deps.hasActiveMirrorLease();
  }

  async function clearScreencastHandle(): Promise<void> {
    const handle = screencastHandle;
    screencastHandle = undefined;
    liveSize = undefined;
    liveDpr = undefined;
    if (handle !== undefined) await handle.stop();
  }

  function startScreenshotFallback(): void {
    if (wantsFallbackFrames()) frameLoop.start();
  }

  async function stopScreencast(): Promise<void> {
    await clearScreencastHandle();
    // Producer gone while the workbench still wants frames: degrade in place.
    // Callers that already released the lease (panel stop) will not restart.
    startScreenshotFallback();
  }

  const frameLoop: FrameLoop = createFrameLoop({
    capture: async () => {
      const activePage = await deps.getPage();
      const buffer = await activePage.screenshot({
        type: 'jpeg',
        quality: BROWSER_SCREENSHOT_QUALITY,
      });
      const viewport = activePage.viewportSize() ?? {
        width: deps.maxDimension,
        height: deps.maxDimension,
      };
      const bytes = new Uint8Array(buffer);
      const encoded = readJpegSize(bytes) ?? {
        width: viewport.width,
        height: viewport.height,
      };
      return {
        bytes,
        width: viewport.width,
        height: viewport.height,
        encodedWidth: encoded.width,
        encodedHeight: encoded.height,
        sourceDpr: await deps.resolveDeviceScaleFactor(activePage),
      };
    },
    // HostRuntime keeps one event subscriber for the service lifetime so tool
    // state can still be forwarded. That subscriber must not itself keep the
    // frame timer or Chromium alive while the desktop panel is closed.
    // A live screencast is the sole producer — screenshot capture is skipped.
    hasSubscriber: () => wantsFallbackFrames(),
    intervalMs: Math.round(1000 / deps.maxFps),
    emit: (frame) => {
      deps.onFrame({
        bytes: frame.bytes,
        width: frame.width,
        height: frame.height,
        encodedWidth: frame.encodedWidth,
        encodedHeight: frame.encodedHeight,
        sourceDpr: frame.sourceDpr,
        quality: BROWSER_SCREENSHOT_QUALITY,
        producer: 'screenshot-fallback',
      });
    },
  });

  async function startMirrorFrames(activePage: Page): Promise<void> {
    const viewport = activePage.viewportSize() ?? {
      width: deps.maxDimension,
      height: deps.maxDimension,
    };
    const deviceScaleFactor = await deps.resolveDeviceScaleFactor(activePage);
    const size = resolveBrowserScreencastSize({
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor,
    });
    if (!size) return;
    if (
      screencastHandle !== undefined &&
      liveSize &&
      sameScreencastSize(liveSize, size) &&
      liveDpr === deviceScaleFactor
    ) {
      frameLoop.stop();
      return;
    }
    if (screencastHandle !== undefined) {
      await clearScreencastHandle();
    }
    frameLoop.stop();
    try {
      const maxFps = resolveBrowserScreencastFps(size.width * size.height, deps.maxFps);
      const screencastQuality = deps.screencastQuality ?? BROWSER_SCREENCAST_QUALITY;
      screencastHandle = await startScreencast(activePage, {
        size,
        quality: screencastQuality,
        maxFps,
        emit: (frame) => {
          if (!deps.hasActiveMirrorLease()) return;
          deps.onFrame({
            bytes: frame.bytes,
            width: frame.width,
            height: frame.height,
            encodedWidth: frame.encodedWidth,
            encodedHeight: frame.encodedHeight,
            sourceDpr: deviceScaleFactor,
            quality: screencastQuality,
            producer: 'screencast',
          });
        },
      });
      liveSize = size;
      liveDpr = deviceScaleFactor;
    } catch (error) {
      screencastHandle = undefined;
      liveSize = undefined;
      liveDpr = undefined;
      console.warn(
        '[browser] screencast failed; falling back to screenshot frames',
        error instanceof Error ? error.message : error,
      );
      startScreenshotFallback();
    }
  }

  return {
    frameLoop,
    hasScreencast: () => screencastHandle !== undefined,
    startMirrorFrames,
    stopScreencast,
  };
}
