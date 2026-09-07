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

export type BrowserMirrorDeps = {
  maxDimension: number;
  maxFps: number;
  getPage: () => Promise<Page>;
  hasActiveMirrorLease: () => boolean;
  subscribers: Set<(event: BrowserSessionEvent) => void>;
};

export type BrowserMirror = {
  frameLoop: FrameLoop;
  hasScreencast(): boolean;
  startMirrorFrames(activePage: Page): Promise<void>;
  stopScreencast(): Promise<void>;
};

export function createBrowserMirror(deps: BrowserMirrorDeps): BrowserMirror {
  let screencastHandle: ScreencastHandle | undefined;

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
      const buffer = await activePage.screenshot({ type: 'jpeg', quality: 70 });
      const viewport = activePage.viewportSize() ?? {
        width: deps.maxDimension,
        height: deps.maxDimension,
      };
      return {
        dataUrl: `data:image/jpeg;base64,${buffer.toString('base64')}`,
        width: viewport.width,
        height: viewport.height,
      };
    },
    // HostRuntime keeps one event subscriber for the service lifetime so tool
    // state can still be forwarded. That subscriber must not itself keep the
    // frame timer or Chromium alive while the desktop panel is closed.
    // A live screencast is the sole producer — screenshot capture is skipped.
    hasSubscriber: () => wantsFallbackFrames(),
    intervalMs: Math.round(1000 / deps.maxFps),
    emit: (frame) => {
      const event: BrowserFramePush = { type: 'browser/frame', ...frame };
      for (const listener of deps.subscribers) listener(event);
    },
  });

  async function startMirrorFrames(activePage: Page): Promise<void> {
    if (screencastHandle !== undefined) {
      frameLoop.stop();
      return;
    }
    frameLoop.stop();
    try {
      screencastHandle = await startScreencast(activePage, {
        maxDimension: deps.maxDimension,
        emit: (frame) => {
          if (!deps.hasActiveMirrorLease()) return;
          const event: BrowserFramePush = { type: 'browser/frame', ...frame };
          for (const listener of deps.subscribers) listener(event);
        },
      });
    } catch (error) {
      screencastHandle = undefined;
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
