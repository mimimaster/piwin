// @vitest-environment happy-dom
import { act, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it } from 'vitest';
import { useTranscriptScroll } from './use-transcript-scroll.js';

it('keeps small upward wheel gestures detached until scrolling back toward the tail', async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  let scroll: ReturnType<typeof useTranscriptScroll> | undefined;
  function Harness(): ReactElement {
    scroll = useTranscriptScroll({ messageCount: 1, activitySignal: 'idle' });
    return <div ref={scroll.containerRef} onScroll={scroll.handleScroll} />;
  }
  try {
    await act(async () => root.render(<Harness />));
    const element = container.firstElementChild;
    if (!(element instanceof HTMLDivElement) || !scroll) throw new Error('Missing scroll harness');
    let scrollTop = 800;
    let scrollHeight = 1_000;
    Object.defineProperties(element, {
      clientHeight: { configurable: true, value: 200 },
      scrollHeight: { configurable: true, get: () => scrollHeight },
      scrollTop: {
        configurable: true,
        get: () => scrollTop,
        set: (value: number) => { scrollTop = Math.max(0, Math.min(value, scrollHeight - 200)); },
      },
    });
    await act(async () => scroll?.jumpToLatest());
    act(() => {
      element.dispatchEvent(new WheelEvent('wheel', { deltaY: -12 }));
      element.scrollTop = 788;
      element.dispatchEvent(new Event('scroll'));
    });
    expect(scroll.followTail).toBe(false);
    // A queued scroll event with no movement must not re-enable following.
    act(() => element.dispatchEvent(new Event('scroll')));
    expect(scroll.followTail).toBe(false);
    act(() => {
      scrollHeight += 20;
      element.scrollTop += 20;
      element.dispatchEvent(new Event('scroll'));
      scroll?.notifyContentGrew();
    });
    expect(scroll.followTail).toBe(false);
    expect(element.scrollTop).toBe(808);
    act(() => {
      element.scrollTop += 6;
      element.dispatchEvent(new Event('scroll'));
    });
    expect(scroll.followTail).toBe(true);
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});

it('does not yank back to the tail when the first history scroll is still in the near-bottom zone', async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  let scroll: ReturnType<typeof useTranscriptScroll> | undefined;
  function Harness(): ReactElement {
    scroll = useTranscriptScroll({ messageCount: 1, activitySignal: 'idle' });
    return <div ref={scroll.containerRef} onScroll={scroll.handleScroll} />;
  }
  try {
    await act(async () => root.render(<Harness />));
    const element = container.firstElementChild;
    if (!(element instanceof HTMLDivElement) || !scroll) throw new Error('Missing scroll harness');
    let scrollTop = 800;
    let scrollHeight = 1_000;
    Object.defineProperties(element, {
      clientHeight: { configurable: true, value: 200 },
      scrollHeight: { configurable: true, get: () => scrollHeight },
      scrollTop: {
        configurable: true,
        get: () => scrollTop,
        set: (value: number) => {
          scrollTop = Math.max(0, Math.min(value, scrollHeight - 200));
        },
      },
    });
    await act(async () => scroll?.jumpToLatest());
    expect(element.scrollTop).toBe(800);
    // WKWebView / trackpad often delivers the first history pixels as a scroll
    // event still inside the 64px tail zone, without a qualifying wheel delta.
    // A coincident virtualizer measure must not restick.
    act(() => {
      element.scrollTop = 760;
      element.dispatchEvent(new Event('scroll'));
      scrollHeight += 80;
      scroll?.notifyContentGrew();
    });
    expect(scroll.followTail).toBe(false);
    expect(element.scrollTop).toBe(760);
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});
