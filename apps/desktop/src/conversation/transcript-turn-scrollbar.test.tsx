// @vitest-environment happy-dom
import { act, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionUserMessageAnchor, SessionUserMessageIndexData } from '@piwin/contracts';
import { TranscriptScrollProvider } from './transcript-scroll-port';
import { TranscriptTurnScrollbar } from './transcript-turn-scrollbar';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

function anchor(ordinal: number, span: number): SessionUserMessageAnchor {
  return {
    messageId: `turn-${ordinal}`,
    ordinal,
    createdAt: '2026-10-01T00:00:00Z',
    preview: `request ${ordinal}`,
    spanStartOrdinal: ordinal,
    spanEndOrdinal: ordinal + span - 1,
  };
}

const INDEX: SessionUserMessageIndexData = {
  sessionId: 'session-long',
  revision: 'rev-1',
  totalUserMessages: 500,
  mode: 'sampled',
  anchors: Array.from({ length: 20 }, (_, bucket) => anchor(bucket * 25, 25)),
  anchorBytes: 0,
};

describe('TranscriptTurnScrollbar', () => {
  let container: HTMLDivElement;
  let root: Root;
  let stream: HTMLDivElement;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    stream = document.createElement('div');
    Object.defineProperty(stream, 'scrollHeight', { configurable: true, value: 2000 });
    Object.defineProperty(stream, 'clientHeight', { configurable: true, value: 500 });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function render(onJumpToAnchor: (anchor: SessionUserMessageAnchor) => void, markJumpOrigin = vi.fn()) {
    const scrollElementRef = createRef<HTMLDivElement | null>() as { current: HTMLDivElement | null };
    scrollElementRef.current = stream;
    act(() => {
      root.render(
        <TranscriptScrollProvider
          sessionId="session-long"
          scrollElementRef={scrollElementRef}
          markJumpOrigin={markJumpOrigin}
        >
          <TranscriptTurnScrollbar
            isOverflowing
            scrollRatio={0.25}
            scrollProgress={1}
            // The live tail holds the last 100 of 500 turns.
            span={{ firstOrdinal: 400, count: 100, total: 500 }}
            historyIndex={INDEX}
            onJumpToAnchor={onJumpToAnchor}
            locale="zh-CN"
          />
        </TranscriptScrollProvider>,
      );
    });
    const track = container.querySelector<HTMLElement>('[data-testid="chat-stream-floating-scrollbar"]');
    if (!track) throw new Error('missing track');
    vi.spyOn(track, 'getBoundingClientRect').mockReturnValue({
      top: 0,
      bottom: 100,
      height: 100,
      left: 0,
      right: 4,
      width: 4,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);
    const thumb = container.querySelector<HTMLElement>(
      '[data-testid="chat-stream-floating-scrollbar-thumb"]',
    );
    if (!thumb) throw new Error('missing thumb');
    return { track, thumb, markJumpOrigin };
  }

  function mouse(target: EventTarget, type: string, clientY: number): void {
    act(() => {
      target.dispatchEvent(new window.MouseEvent(type, { bubbles: true, cancelable: true, clientY }));
    });
  }

  it('places the live tail at the end of the whole session', () => {
    const { track, thumb } = render(vi.fn());
    expect(track.dataset.turnScale).toBe('session');
    // 25% of the window's 20% share of turns → the 8% floor, at the bottom.
    expect(thumb.style.height).toBe('8%');
    expect(thumb.style.top).toBe('92%');
  });

  it('scrolls pixels inside the resident turns and seeks once on release outside them', () => {
    const onJumpToAnchor = vi.fn();
    const { thumb, markJumpOrigin } = render(onJumpToAnchor);
    mouse(thumb, 'mousedown', 95);
    mouse(document, 'mousemove', 90);
    // Turn 450 of 500 is halfway through the resident 400..500.
    expect(stream.scrollTop).toBe(750);
    expect(container.querySelector('[data-testid="turn-scrollbar-label"]')?.textContent).toBe(
      '第 451 / 500 轮',
    );

    mouse(document, 'mousemove', 21);
    expect(container.querySelector('[data-testid="turn-scrollbar-label"]')?.textContent).toBe(
      '第 106 / 500 轮',
    );
    // The thumb follows the pointer while the transcript cannot.
    expect(thumb.style.top).toBe(`${0.21 * 92}%`);
    expect(onJumpToAnchor).not.toHaveBeenCalled();

    mouse(document, 'mouseup', 21);
    expect(markJumpOrigin).toHaveBeenCalledTimes(1);
    expect(onJumpToAnchor).toHaveBeenCalledTimes(1);
    expect(onJumpToAnchor.mock.calls[0]?.[0]).toMatchObject({ messageId: 'turn-100' });
    expect(container.querySelector('[data-testid="turn-scrollbar-label"]')).toBeNull();
  });

  it('seeks the turn under a track click outside the window', () => {
    const onJumpToAnchor = vi.fn();
    const { track } = render(onJumpToAnchor);
    mouse(track, 'mousedown', 50);
    expect(onJumpToAnchor.mock.calls[0]?.[0]).toMatchObject({ messageId: 'turn-250' });
  });
});
