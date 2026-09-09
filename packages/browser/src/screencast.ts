/**
 * Playwright public page.screencast for the workbench mirror.
 * Frames are delivered only via start({ onFrame }); 1.61.1 does not implement
 * .on('screencastFrame'). Playwright owns CDP acks — do not also call
 * Page.startScreencast. Width/height are CSS viewport from onFrame, not JPEG
 * pixel size. Emit is capped so Chrome's ~50 fps stream does not flood Host.
 */
import type { Page } from 'playwright-core';
import { BROWSER_SCREENCAST_QUALITY } from './screencast-size.js';

export type ScreencastFrame = {
  dataUrl: string;
  width: number;
  height: number;
  ts: number;
};

export type ScreencastHandle = {
  stop(): Promise<void>;
};

const DEFAULT_MAX_FPS = 12;

type PublicScreencast = {
  start(options: {
    onFrame: (frame: {
      data: Buffer;
      timestamp: number;
      viewportWidth: number;
      viewportHeight: number;
    }) => void;
    size: { width: number; height: number };
    quality: number;
  }): Promise<unknown>;
  stop(): Promise<void>;
};

function getPublicScreencast(page: Page): PublicScreencast {
  const candidate: unknown = page.screencast;
  if (typeof candidate !== 'object' || candidate === null) {
    throw new Error('page.screencast.start is unavailable');
  }
  const screencast = candidate as { start?: unknown; stop?: unknown };
  if (typeof screencast.start !== 'function' || typeof screencast.stop !== 'function') {
    throw new Error('page.screencast.start is unavailable');
  }
  return candidate as PublicScreencast;
}

async function stopQuietly(screencast: PublicScreencast): Promise<void> {
  try {
    await screencast.stop();
  } catch {
    // Not running, or the page/context is already gone.
  }
}

export async function startScreencast(
  page: Page,
  options: {
    size: { width: number; height: number };
    emit: (frame: ScreencastFrame) => void;
    quality?: number;
    maxFps?: number;
    now?: () => number;
  },
): Promise<ScreencastHandle> {
  const screencast = getPublicScreencast(page);
  const quality = options.quality ?? BROWSER_SCREENCAST_QUALITY;
  const minIntervalMs = Math.round(1000 / (options.maxFps ?? DEFAULT_MAX_FPS));
  const now = options.now ?? Date.now;
  let stopped = false;
  let lastEmit = -Infinity;

  const handleFrame = (frame: {
    data: Buffer;
    timestamp: number;
    viewportWidth: number;
    viewportHeight: number;
  }): void => {
    if (stopped) return;
    if (frame.viewportWidth <= 0 || frame.viewportHeight <= 0) return;
    const ts = now();
    if (ts - lastEmit < minIntervalMs) return;
    lastEmit = ts;
    try {
      options.emit({
        dataUrl: `data:image/jpeg;base64,${Buffer.from(frame.data).toString('base64')}`,
        width: frame.viewportWidth,
        height: frame.viewportHeight,
        ts,
      });
    } catch {
      // Emit is best-effort. onFrame must not throw so Playwright can ack.
    }
  };

  const startOptions = {
    onFrame: handleFrame,
    size: options.size,
    quality,
  };

  try {
    await screencast.start(startOptions);
  } catch (error) {
    // Client sets _started before the channel call; stop leftover then rebuild once.
    await stopQuietly(screencast);
    try {
      await screencast.start(startOptions);
    } catch {
      await stopQuietly(screencast);
      throw error;
    }
  }

  return {
    async stop(): Promise<void> {
      if (stopped) return;
      stopped = true;
      await stopQuietly(screencast);
    },
  };
}
