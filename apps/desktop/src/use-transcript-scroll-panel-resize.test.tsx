// @vitest-environment happy-dom
import { act, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it } from 'vitest';
import { beginPanelResize } from './panel-resize-activity.js';
import { useTranscriptScroll } from './use-transcript-scroll.js';

function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => resolve());
  });
}

it('coalesces follow-tail sticks to one frame during a panel drag and settles on release', async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  let scroll: ReturnType<typeof useTranscriptScroll> | undefined;
  function Harness(): ReactElement {
    scroll = useTranscriptScroll({ messageCount: 1, activitySignal: 'idle' });
    return <div ref={scroll.containerRef} onScroll={scroll.handleScroll} />;
  }
  let release: (() => void) | null = null;
  try {
    await act(async () => root.render(<Harness />));
    const element = container.firstElementChild;
    if (!(element instanceof HTMLDivElement) || !scroll) throw new Error('Missing scroll harness');
    let scrollTop = 800;
    let scrollHeight = 1_000;
    let scrollHeightReads = 0;
    Object.defineProperties(element, {
      clientHeight: { configurable: true, value: 200 },
      scrollHeight: {
        configurable: true,
        get: () => {
          scrollHeightReads += 1;
          return scrollHeight;
        },
      },
      scrollTop: {
        configurable: true,
        get: () => scrollTop,
        set: (value: number) => {
          scrollTop = Math.max(0, Math.min(value, scrollHeight - 200));
        },
      },
    });
    await act(async () => scroll?.jumpToLatest());
    expect(scroll.followTail).toBe(true);

    release = beginPanelResize();
    scrollHeightReads = 0;
    act(() => {
      scrollHeight = 1_100;
      scroll?.notifyContentGrew();
      scroll?.notifyContentGrew();
      scroll?.measure();
    });
    // Drag frames must not force layout synchronously for each request.
    expect(scrollHeightReads).toBe(0);
    expect(scrollTop).toBe(800);

    await act(async () => {
      await nextFrame();
    });
    // One coalesced stick per frame keeps the live tail visible while dragging.
    expect(scrollTop).toBe(900);

    act(() => {
      scrollHeight = 1_250;
      release?.();
      release = null;
    });
    // Release settles immediately against the final width's geometry.
    expect(scrollTop).toBe(1_050);
    expect(scroll.followTail).toBe(true);
  } finally {
    release?.();
    act(() => root.unmount());
    container.remove();
  }
});
