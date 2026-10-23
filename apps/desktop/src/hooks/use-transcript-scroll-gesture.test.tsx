// @vitest-environment happy-dom
import { act, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { LOCAL_FOLD_SETTLE_MS, useTranscriptScroll } from './use-transcript-scroll.js';

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

it('does not pin to the tail while a user-owned call-chain fold remasures', async () => {
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
    expect(scroll.followTail).toBe(true);

    act(() => {
      scroll?.beginLocalFoldLayout();
      scrollHeight += 400;
      scroll?.notifyContentGrew();
    });

    expect(scroll.followTail).toBe(true);
    expect(element.scrollTop).toBe(800);
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});

it('keeps the tail unpinned for the whole fold animation, then follows again', async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
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

    act(() => scroll?.beginLocalFoldLayout());
    // Mid-animation growth (a 240ms grid/max-height fold) keeps the clicked row put.
    act(() => {
      vi.advanceTimersByTime(200);
      scrollHeight += 300;
      scroll?.notifyContentGrew();
    });
    expect(element.scrollTop).toBe(800);

    act(() => {
      vi.advanceTimersByTime(LOCAL_FOLD_SETTLE_MS);
      scrollHeight += 50;
      scroll?.notifyContentGrew();
    });
    expect(scroll.followTail).toBe(true);
    expect(element.scrollTop).toBe(scrollHeight - 200);
  } finally {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  }
});

it('requests older history on wheel-up when the fitted page cannot scroll', async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  let scroll: ReturnType<typeof useTranscriptScroll> | undefined;
  const onUnscrollableHistoryIntent = vi.fn();
  function Harness(): ReactElement {
    scroll = useTranscriptScroll({
      messageCount: 1,
      activitySignal: 'idle',
      canLoadOlder: true,
      onUnscrollableHistoryIntent,
    });
    return <div ref={scroll.containerRef} onScroll={scroll.handleScroll} />;
  }
  try {
    await act(async () => root.render(<Harness />));
    const element = container.firstElementChild;
    if (!(element instanceof HTMLDivElement) || !scroll) throw new Error('Missing scroll harness');
    Object.defineProperties(element, {
      clientHeight: { configurable: true, value: 400 },
      scrollHeight: { configurable: true, value: 300 },
      scrollTop: { configurable: true, writable: true, value: 0 },
    });
    await act(async () => scroll?.jumpToLatest());
    expect(scroll.followTail).toBe(true);
    act(() => {
      element.dispatchEvent(new WheelEvent('wheel', { deltaY: -24 }));
    });
    expect(onUnscrollableHistoryIntent).toHaveBeenCalledTimes(1);
    expect(scroll.followTail).toBe(true);
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});
