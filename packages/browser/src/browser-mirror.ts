/**
 * Single-producer workbench mirror: public page.screencast with screenshot
 * frame-loop fallback. Does not own Chromium lifetime. A live screencast must
 * not run frameLoop; producer stop/failure degrades to screenshots without
 * relaunching the browser.
 */
import type { Page } from 'playwright-core';
import { createFrameLoop, type FrameLoop } from './frames.js';
import { startScreencast, type ScreencastHandle } from './screencast.js';
import type { BrowserFramePush, BrowserSessionEvent } from './browser-session.js';
import {
  BROWSER_SCREENCAST_QUALITY,
  BROWSER_SCREENSHOT_QUALITY,
  resolveBrowserScreencastFps,
  resolveBrowserScreencastSize,
  type BrowserScreencastSize,
} from './screencast-size.js';
import { readJpegSize } from './jpeg-size.js';

export type BrowserMirrorDeps = {
  maxDimension: number;
  maxFps: number;
  getPage: () => Promise<Page>;
  hasActiveMirrorLease: () => boolean;
  resolveDeviceScaleFactor: (page: Page) => Promise<number>;
  subscribers: Set<(event: BrowserSessionEvent) => void>;
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
  let frameSeq = 0;

  function nextFrameId(): string {
    frameSeq += 1;
    return String(frameSeq);
  }

  function wantsFallbackFrames(): boolean {
    return (
      screencastHandle === undefined &&
      deps.hasActiveMirrorLease() &&
      deps.subscribers.size > 0
    );
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
      const encoded = readJpegSize(buffer) ?? {
        width: viewport.width,
        height: viewport.height,
      };
      return {
        dataUrl: `data:image/jpeg;base64,${buffer.toString('base64')}`,
        width: viewport.width,
        height: viewport.height,
        encodedWidth: encoded.width,
        encodedHeight: encoded.height,
        byteLength: buffer.byteLength,
      };
    },
    // HostRuntime keeps one event subscriber for the service lifetime so tool
    // state can still be forwarded. That subscriber must not itself keep the
    // frame timer or Chromium alive while the desktop panel is closed.
    // A live screencast is the sole producer — screenshot capture is skipped.
    hasSubscriber: () => wantsFallbackFrames(),
    intervalMs: Math.round(1000 / deps.maxFps),
    emit: (frame) => {
      const event: BrowserFramePush = {
        type: 'browser/frame',
        ...frame,
        producer: 'screenshot-fallback',
        quality: BROWSER_SCREENSHOT_QUALITY,
        frameId: nextFrameId(),
      };
      for (const listener of deps.subscribers) listener(event);
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
      screencastHandle = await startScreencast(activePage, {
        size,
        quality: BROWSER_SCREENCAST_QUALITY,
        maxFps,
        emit: (frame) => {
          if (!deps.hasActiveMirrorLease()) return;
          const event: BrowserFramePush = {
            type: 'browser/frame',
            ...frame,
            sourceDpr: deviceScaleFactor,
            quality: BROWSER_SCREENCAST_QUALITY,
            producer: 'screencast',
            frameId: nextFrameId(),
          };
          for (const listener of deps.subscribers) listener(event);
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
