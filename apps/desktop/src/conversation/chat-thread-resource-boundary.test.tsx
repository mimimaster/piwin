// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { MediaPreviewReadProvider } from '../media/media-preview-read-context.js';
import {
  sessionRenderResources,
  sessionRenderResourceKey,
} from '../session/session-render-resources.js';
import { ChatThreadResourceBoundary } from './chat-thread-resource-boundary.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

it('keeps current rows intact and replaces only inactive rows with their painted height', async () => {
  vi.useFakeTimers();
  sessionRenderResources.reset();
  const container = document.createElement('div');
  const root = createRoot(container);
  try {
    await act(async () => {
      sessionRenderResources.setVisible([sessionRenderResourceKey('local', 'first')]);
      root.render(
        <MediaPreviewReadProvider sessionId="first" resourceHostKey="local" readMedia={null}>
          <textarea data-testid="composer" defaultValue="keep draft" />
          <ChatThreadResourceBoundary sessionId="first">
            {(elementRef) => (
              <div ref={elementRef} data-testid="rows">
                <input defaultValue="keep current view" />
              </div>
            )}
          </ChatThreadResourceBoundary>
        </MediaPreviewReadProvider>,
      );
    });
    const rows = container.querySelector<HTMLDivElement>('[data-testid="rows"]');
    if (!rows) throw new Error('rows missing');
    vi.spyOn(rows, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 600, 800));
    await act(async () => {
      sessionRenderResources.requestReclaim();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(container.querySelector('[data-testid="rows"]')).toBe(rows);
    await act(async () => {
      sessionRenderResources.setVisible([sessionRenderResourceKey('local', 'second')]);
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(container.querySelector('[data-testid="rows"]')).toBeNull();
    expect(
      container.querySelector<HTMLElement>('[data-testid="chat-thread-reclaimed"]')?.style.height,
    ).toBe('800px');
    expect(container.querySelector<HTMLTextAreaElement>('[data-testid="composer"]')?.value).toBe(
      'keep draft',
    );
    await act(async () => {
      sessionRenderResources.setVisible([sessionRenderResourceKey('local', 'first')]);
    });
    expect(container.querySelector('[data-testid="rows"]')).not.toBeNull();
  } finally {
    act(() => root.unmount());
    sessionRenderResources.reset();
    vi.restoreAllMocks();
    vi.useRealTimers();
  }
});
