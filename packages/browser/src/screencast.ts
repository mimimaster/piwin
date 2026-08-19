/**
 * Chrome DevTools screencast for the desktop workbench (ADR 0057).
 * JPEG frames are emitted with CSS viewport width/height from CDP metadata.
 * Every frame must be acked or Chrome stops sending.
 */
import type { Page } from 'playwright-core';

export type ScreencastFrame = {
  dataUrl: string;
  width: number;
  height: number;
  ts: number;
};

export type ScreencastHandle = {
  stop(): Promise<void>;
};

type CdpSession = {
  on(event: string, listener: (payload: unknown) => void): void;
  send(method: string, params?: Record<string, unknown>): Promise<unknown>;
  detach(): Promise<void>;
};

function readScreencastFrame(payload: unknown): {
  data: string;
  sessionId: number;
  deviceWidth: number;
  deviceHeight: number;
} | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const record = payload as Record<string, unknown>;
  if (typeof record.data !== 'string' || typeof record.sessionId !== 'number') {
    return null;
  }
  const metadata =
    typeof record.metadata === 'object' && record.metadata !== null
      ? (record.metadata as Record<string, unknown>)
      : {};
  const deviceWidth = typeof metadata.deviceWidth === 'number' ? metadata.deviceWidth : 0;
  const deviceHeight = typeof metadata.deviceHeight === 'number' ? metadata.deviceHeight : 0;
  if (deviceWidth <= 0 || deviceHeight <= 0) return null;
  return { data: record.data, sessionId: record.sessionId, deviceWidth, deviceHeight };
}

export async function startScreencast(
  page: Page,
  options: {
    maxDimension: number;
    quality?: number;
    emit: (frame: ScreencastFrame) => void;
  },
): Promise<ScreencastHandle> {
  const quality = options.quality ?? 55;
  const cdp = (await page.context().newCDPSession(page)) as unknown as CdpSession;
  let stopped = false;

  cdp.on('Page.screencastFrame', (payload) => {
    const frame = readScreencastFrame(payload);
    const sessionId =
      frame?.sessionId ??
      (typeof payload === 'object' &&
      payload !== null &&
      typeof (payload as { sessionId?: unknown }).sessionId === 'number'
        ? (payload as { sessionId: number }).sessionId
        : undefined);
    if (frame && !stopped) {
      try {
        options.emit({
          dataUrl: `data:image/jpeg;base64,${frame.data}`,
          width: frame.deviceWidth,
          height: frame.deviceHeight,
          ts: Date.now(),
        });
      } catch {
        // Emit is best-effort; ack still required so Chrome keeps sending.
      }
    }
    if (sessionId !== undefined) {
      void cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => undefined);
    }
  });

  try {
    await cdp.send('Page.startScreencast', {
      format: 'jpeg',
      quality,
      maxWidth: options.maxDimension,
      maxHeight: options.maxDimension,
    });
  } catch (error) {
    try {
      await cdp.detach();
    } catch (detachError) {
      throw new AggregateError(
        [error, detachError],
        'screencast start and CDP detach both failed',
      );
    }
    throw error;
  }

  return {
    async stop(): Promise<void> {
      if (stopped) return;
      stopped = true;
      try {
        await cdp.send('Page.stopScreencast');
      } catch {
        // Page may already be closed; detach still runs.
      }
      try {
        await cdp.detach();
      } catch {
        // Detach after context close is expected.
      }
    },
  };
}
