// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HostCommand, HostResponse, MediaLibraryItem } from '@piwin/contracts';
import { LazyMediaTile } from './lazy-media-tile';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('@tauri-apps/api/core', () => ({
  convertFileSrc: undefined,
}));

const VIDEO_ITEM: MediaLibraryItem = {
  assetId: 'vid-1',
  sessionId: 'sess-1',
  mimeType: 'video/mp4',
  byteSize: 4,
  createdAt: '2026-09-06T00:00:00.000Z',
  kind: 'video',
  model: 'grok-imagine-video',
};

function mediaReadOk(): HostResponse {
  return {
    type: 'response',
    command: 'media/read',
    success: true,
    data: {
      status: 'ready',
      assetId: 'vid-1',
      sessionId: 'sess-1',
      mimeType: 'video/mp4',
      byteSize: 4,
      base64Data: 'AAAAAA==',
    },
  };
}

function countMediaReads(request: ReturnType<typeof vi.fn>): number {
  return request.mock.calls.filter((call) => {
    const command = call[0] as HostCommand | undefined;
    return command?.type === 'media/read';
  }).length;
}

async function flush(times = 12): Promise<void> {
  for (let index = 0; index < times; index += 1) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => {
      await Promise.resolve();
    });
  }
}

describe('LazyMediaTile video preview', () => {
  let container: HTMLDivElement;
  let root: Root;
  let blobSerial = 0;

  beforeEach(() => {
    blobSerial = 0;
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => {
      blobSerial += 1;
      return `blob:video-thumb-${blobSerial}`;
    });
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(callback: IntersectionObserverCallback) {
          this.callback = callback;
        }
        callback: IntersectionObserverCallback;
        observe(element: Element): void {
          this.callback(
            [{ isIntersecting: true, target: element } as IntersectionObserverEntry],
            this as unknown as IntersectionObserver,
          );
        }
        disconnect(): void {}
        unobserve(): void {}
      },
    );
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function renderTile(request: (command: HostCommand) => Promise<HostResponse>): void {
    act(() => {
      root.render(
        <LazyMediaTile
          item={VIDEO_ITEM}
          request={request}
          locale="zh-CN"
          deleteLabel="删除"
          onOpen={() => undefined}
          onDelete={() => undefined}
        />,
      );
    });
  }

  it('does not rebuild the video blob when the parent request identity churns', async () => {
    const firstRequest = vi.fn(async () => mediaReadOk());
    renderTile(firstRequest);
    await flush();

    const video = container.querySelector('video');
    expect(video).not.toBeNull();
    expect(video?.getAttribute('src')).toBe('blob:video-thumb-1');
    expect(video?.getAttribute('src') ?? '').not.toContain('#');
    const readsAfterLoad = countMediaReads(firstRequest);
    expect(readsAfterLoad).toBeGreaterThan(0);
    expect(blobSerial).toBe(1);

    for (let index = 0; index < 5; index += 1) {
      const nextRequest = vi.fn(async () => mediaReadOk());
      renderTile(nextRequest);
      await flush(4);
      expect(countMediaReads(nextRequest)).toBe(0);
    }

    expect(container.querySelector('video')?.getAttribute('src')).toBe('blob:video-thumb-1');
    expect(countMediaReads(firstRequest)).toBe(readsAfterLoad);
    expect(blobSerial).toBe(1);
  });
});

