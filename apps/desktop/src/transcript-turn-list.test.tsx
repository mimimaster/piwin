// @vitest-environment happy-dom
import { act, useRef, type ReactElement, type RefObject } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TranscriptScrollProvider } from './transcript-scroll-port';
import {
  createTranscriptRangeExtractor,
  shouldAdjustTranscriptScrollOnItemSizeChange,
  shouldVirtualizeTranscript,
  TRANSCRIPT_VIRTUALIZATION_THRESHOLD,
  TRANSCRIPT_TURN_GAP_PX,
  buildTranscriptTurnsStructureKey,
  buildTranscriptStreamingMeasureKey,
  transcriptVirtualizerMeasurePolicy,
} from './transcript-turn-policy.js';
import { TranscriptTurnList } from './transcript-turn-list.js';
import { groupTranscriptTurns, type TranscriptTurn } from './transcript-turns';
import type { ChatMessageUi } from './chat-reducer';
import { rememberTranscriptTurnHeight } from './transcript-scroll-memory';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

function createTurns(count: number): TranscriptTurn[] {
  const messages: ChatMessageUi[] = Array.from({ length: count }, (_, index) => ({
    id: `user-${index}`,
    role: 'user',
    text: `Prompt ${index}`,
    thinking: '',
    tools: [],
    attachments: [],
    status: 'done',
  }));
  return groupTranscriptTurns(messages);
}

function renderTurn(turn: TranscriptTurn): ReactElement {
  const messageId = turn.items[0]?.message.id ?? turn.id;
  return (
    <section id={`msg-${messageId}`} data-testid="rendered-turn">
      {messageId}
    </section>
  );
}

function renderEditableTurn(turn: TranscriptTurn): ReactElement {
  const messageId = turn.items[0]?.message.id ?? turn.id;
  return (
    <section id={`msg-${messageId}`}>
      <input data-testid={`editor-${messageId}`} defaultValue={messageId} />
    </section>
  );
}

describe('transcript turn window', () => {
  let container: HTMLDivElement;
  let root: Root;
  let geometrySpy: ReturnType<typeof vi.spyOn> | null;
  let originalResizeObserver: typeof ResizeObserver | undefined;
  let turnHeightOverrides: Map<string, number>;
  let resizeObserverHarnesses: Array<{
    callback: ResizeObserverCallback;
    observer: ResizeObserver;
    targets: Set<Element>;
  }>;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    originalResizeObserver = window.ResizeObserver;
    turnHeightOverrides = new Map();
    resizeObserverHarnesses = [];
    class TestResizeObserver implements ResizeObserver {
      readonly harness: (typeof resizeObserverHarnesses)[number];

      constructor(callback: ResizeObserverCallback) {
        this.harness = { callback, observer: this, targets: new Set() };
        resizeObserverHarnesses.push(this.harness);
      }

      disconnect(): void {
        this.harness.targets.clear();
      }

      observe(target: Element): void {
        this.harness.targets.add(target);
      }

      unobserve(target: Element): void {
        this.harness.targets.delete(target);
      }
    }
    window.ResizeObserver = TestResizeObserver;
    globalThis.ResizeObserver = TestResizeObserver;
    geometrySpy = vi
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockImplementation(function getTestBounds(this: HTMLElement): DOMRect {
        const turnId = this.dataset.turnId;
        // Measure the inner body (natural height). Outer slots are height-locked.
        // A detached node has no box, as in a real layout engine.
        const height = !this.isConnected
          ? 0
          : this.classList.contains('transcript-turn-window-item-body')
          ? ((turnId ? turnHeightOverrides.get(turnId) : undefined) ?? 120)
          : this.classList.contains('transcript-turn-window-item')
            ? Number.parseFloat(this.style.height || '0') || 0
            : 0;
        return {
          top: 0,
          right: 900,
          bottom: height,
          left: 0,
          width: 900,
          height,
          x: 0,
          y: 0,
          toJSON: () => ({}),
        } as DOMRect;
      });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    geometrySpy?.mockRestore();
    geometrySpy = null;
    if (originalResizeObserver) {
      window.ResizeObserver = originalResizeObserver;
      globalThis.ResizeObserver = originalResizeObserver;
    }
  });

  it('falls back to a full mount only when no scroll port is available', () => {
    const turns = createTurns(10);
    act(() => {
      root.render(
        <TranscriptTurnList turns={turns} pinnedMessageId={null} renderTurn={renderTurn} />,
      );
    });

    expect(container.querySelectorAll('[data-testid="rendered-turn"]')).toHaveLength(10);
    expect(container.querySelector('[data-testid="transcript-turn-window"]')).toBeNull();
  });

  it('renders before the first frame when the scroll root mounts with the transcript', () => {
    function OpeningTranscript(): ReactElement {
      const scrollElementRef = useRef<HTMLDivElement | null>(null);
      return (
        <TranscriptScrollProvider sessionId="session-first-commit" scrollElementRef={scrollElementRef}>
          <div ref={(element) => {
            scrollElementRef.current = element;
            if (element) Object.defineProperties(element, {
              offsetHeight: { configurable: true, value: 640 },
              offsetWidth: { configurable: true, value: 900 },
            });
          }}>
            <TranscriptTurnList turns={createTurns(2)} pinnedMessageId={null} renderTurn={renderTurn} />
          </div>
        </TranscriptScrollProvider>
      );
    }
    act(() => root.render(<OpeningTranscript />));
    expect(container.querySelectorAll('[data-testid="rendered-turn"]')).toHaveLength(2);
  });

  it('windows a short heavy transcript instead of mounting every turn', async () => {
    const turns = createTurns(24);
    for (const turn of turns) {
      rememberTranscriptTurnHeight('session-short-heavy', turn.id, 2_000);
    }
    const scrollElementRef: RefObject<HTMLDivElement | null> = { current: container };
    Object.defineProperties(container, {
      offsetHeight: { configurable: true, writable: true, value: 640 },
      offsetWidth: { configurable: true, writable: true, value: 900 },
      clientHeight: { configurable: true, writable: true, value: 640 },
      scrollHeight: { configurable: true, writable: true, value: 56_000 },
      scrollTop: { configurable: true, writable: true, value: 55_000 },
    });

    await act(async () => {
      root.render(
        <TranscriptScrollProvider sessionId="session-short-heavy" scrollElementRef={scrollElementRef}>
          <TranscriptTurnList turns={turns} pinnedMessageId={null} renderTurn={renderTurn} />
        </TranscriptScrollProvider>,
      );
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
    });

    expect(container.querySelector('[data-testid="transcript-turn-window"]')).not.toBeNull();
    const mountedCount = container.querySelectorAll('[data-testid="rendered-turn"]').length;
    expect(mountedCount).toBeGreaterThan(0);
    expect(mountedCount).toBeLessThan(24);
    expect(container.querySelector('#msg-user-23')).not.toBeNull();
  });

  it('bounds mounted rows during streaming while keeping live tail pinned', async () => {
    const turns = createTurns(80);
    const scrollElementRef: RefObject<HTMLDivElement | null> = { current: container };
    Object.defineProperties(container, {
      offsetHeight: { configurable: true, writable: true, value: 640 },
      offsetWidth: { configurable: true, writable: true, value: 900 },
      clientHeight: { configurable: true, writable: true, value: 640 },
      scrollHeight: { configurable: true, writable: true, value: 30_000 },
      scrollTop: { configurable: true, writable: true, value: 29_000 },
    });

    await act(async () => {
      root.render(
        <TranscriptScrollProvider sessionId="session-window" scrollElementRef={scrollElementRef}>
          <TranscriptTurnList
            turns={turns}
            pinnedMessageId={null}
            streaming
            renderTurn={renderTurn}
          />
        </TranscriptScrollProvider>,
      );
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
    });

    expect(container.querySelector('[data-testid="transcript-turn-window"]')).not.toBeNull();
    const mountedCount = container.querySelectorAll('[data-testid="rendered-turn"]').length;
    expect(mountedCount).toBeGreaterThan(0);
    expect(mountedCount).toBeLessThan(25);
    // Live tail is pinned
    expect(container.querySelector('#msg-user-79')).not.toBeNull();
  });

  it('bounds mounted rows for a completed long transcript', async () => {
    const turns = createTurns(500);
    const scrollElementRef: RefObject<HTMLDivElement | null> = { current: container };
    Object.defineProperties(container, {
      offsetHeight: { configurable: true, writable: true, value: 640 },
      offsetWidth: { configurable: true, writable: true, value: 900 },
      clientHeight: { configurable: true, writable: true, value: 640 },
      scrollHeight: { configurable: true, writable: true, value: 190_000 },
      scrollTop: { configurable: true, writable: true, value: 0 },
    });

    await act(async () => {
      root.render(
        <TranscriptScrollProvider sessionId="session-window" scrollElementRef={scrollElementRef}>
          <TranscriptTurnList turns={turns} pinnedMessageId={null} renderTurn={renderTurn} />
        </TranscriptScrollProvider>,
      );
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
    });

    expect(container.querySelector('[data-testid="transcript-turn-window"]')).not.toBeNull();
    const mountedCount = container.querySelectorAll('[data-testid="rendered-turn"]').length;
    expect(mountedCount).toBeGreaterThan(0);
    expect(mountedCount).toBeLessThan(25);
    expect(container.querySelector('#msg-user-250')).toBeNull();
  });

  it.each([false, true])('fills the viewport synchronously when scrolling into history (streaming=%s)', async (streaming) => {
    const turns = createTurns(500);
    const scrollElementRef: RefObject<HTMLDivElement | null> = { current: container };
    Object.defineProperties(container, {
      offsetHeight: { configurable: true, value: 640 },
      offsetWidth: { configurable: true, value: 900 },
      clientHeight: { configurable: true, value: 640 },
      scrollHeight: { configurable: true, value: 80_000 },
      scrollTop: { configurable: true, writable: true, value: 0 },
    });
    await act(async () => {
      root.render(
        <TranscriptScrollProvider sessionId={`session-scroll-paint-${streaming}`} scrollElementRef={scrollElementRef}>
          <TranscriptTurnList turns={turns} pinnedMessageId={null} renderTurn={renderTurn} streaming={streaming} />
        </TranscriptScrollProvider>,
      );
    });

    // Establish a position deep in history, beyond the initial overscan.
    act(() => {
      container.scrollTop = 40_000;
      container.dispatchEvent(new Event('scroll'));
    });
    act(() => {
      container.scrollTop = 20_000;
      container.dispatchEvent(new Event('scroll'));
      // Inspect before act flushes deferred React work. The browser can paint
      // the new scroll offset as soon as this event handler returns.
      const viewportHasContent = Array.from(
        container.querySelectorAll<HTMLElement>('.transcript-turn-window-item'),
      ).some((slot) => {
        const start = Number.parseFloat(slot.style.transform.slice('translateY('.length));
        const end = start + Number.parseFloat(slot.style.height);
        return end > container.scrollTop && start < container.scrollTop + container.clientHeight;
      });
      expect(viewportHasContent).toBe(true);
    });
  });

  it('uses delivered row sizes without forcing layout again during a streaming resize', async () => {
    const turns = createTurns(3);
    const scrollElementRef: RefObject<HTMLDivElement | null> = { current: container };
    Object.defineProperties(container, {
      offsetHeight: { configurable: true, value: 640 },
      offsetWidth: { configurable: true, value: 900 },
      clientHeight: { configurable: true, value: 640 },
      scrollHeight: { configurable: true, value: 2_000 },
      scrollTop: { configurable: true, writable: true, value: 0 },
    });
    await act(async () => {
      root.render(
        <TranscriptScrollProvider sessionId="session-resize-cost" scrollElementRef={scrollElementRef}>
          <TranscriptTurnList turns={turns} pinnedMessageId={null} renderTurn={renderTurn} streaming />
        </TranscriptScrollProvider>,
      );
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
    });
    const body = container.querySelector<HTMLElement>('.transcript-turn-window-item-body');
    if (!body) throw new Error('expected a mounted turn');
    const observer = resizeObserverHarnesses.find((harness) => harness.targets.has(body));
    if (!observer) throw new Error('expected a row resize observer');
    const bounds = vi.spyOn(body, 'getBoundingClientRect');
    const offset = vi.spyOn(body, 'offsetHeight', 'get');
    act(() => observer.callback([{
      target: body,
      borderBoxSize: [{ blockSize: 250.25, inlineSize: 600 }],
    } as unknown as ResizeObserverEntry], observer.observer));
    expect(bounds).not.toHaveBeenCalled();
    expect(offset).not.toHaveBeenCalled();
    expect(body.parentElement?.style.height).toBe('251px');
  });

  it('reserves the full measured height of a mounted turn above the cache ceiling', async () => {
    const turns = createTurns(21);
    turnHeightOverrides.set('turn-user-0', 6_000);
    const scrollElementRef: RefObject<HTMLDivElement | null> = { current: container };
    Object.defineProperties(container, {
      offsetHeight: { configurable: true, writable: true, value: 640 },
      offsetWidth: { configurable: true, writable: true, value: 900 },
      clientHeight: { configurable: true, writable: true, value: 640 },
      scrollHeight: { configurable: true, writable: true, value: 12_000 },
      scrollTop: { configurable: true, writable: true, value: 0 },
    });

    await act(async () => {
      root.render(
        <TranscriptScrollProvider sessionId="session-tall" scrollElementRef={scrollElementRef}>
          <TranscriptTurnList turns={turns} pinnedMessageId={null} renderTurn={renderTurn} />
        </TranscriptScrollProvider>,
      );
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
    });

    const turnWindow = container.querySelector<HTMLElement>(
      '[data-testid="transcript-turn-window"]',
    );
    expect(Number.parseFloat(turnWindow?.style.height ?? '0')).toBeGreaterThan(6_000);
  });

  it('locks each absolute slot to its virtual size so neighbors cannot paint over each other', async () => {
    const turns = createTurns(8);
    for (const [index, turn] of turns.entries()) {
      turnHeightOverrides.set(turn.id, 200 + index * 40);
    }
    const scrollElementRef: RefObject<HTMLDivElement | null> = { current: container };
    Object.defineProperties(container, {
      offsetHeight: { configurable: true, writable: true, value: 640 },
      offsetWidth: { configurable: true, writable: true, value: 900 },
      clientHeight: { configurable: true, writable: true, value: 640 },
      scrollHeight: { configurable: true, writable: true, value: 4_000 },
      scrollTop: { configurable: true, writable: true, value: 3_200 },
    });

    await act(async () => {
      root.render(
        <TranscriptScrollProvider sessionId="session-slot-lock" scrollElementRef={scrollElementRef}>
          <TranscriptTurnList turns={turns} pinnedMessageId={null} streaming renderTurn={renderTurn} />
        </TranscriptScrollProvider>,
      );
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
    });

    const slots = [
      ...container.querySelectorAll<HTMLElement>('[data-testid="transcript-turn-window-item"]'),
    ];
    expect(slots.length).toBeGreaterThan(1);
    const placed = slots.map((slot) => {
      const height = Number.parseFloat(slot.style.height || '0');
      const match = /translateY\((-?\d+(?:\.\d+)?)px\)/.exec(slot.style.transform);
      const start = match ? Number.parseFloat(match[1] ?? '0') : Number.NaN;
      return { height, start, end: start + height };
    });
    for (const slot of placed) {
      expect(slot.height).toBeGreaterThan(0);
      expect(Number.isFinite(slot.start)).toBe(true);
    }
    const ordered = [...placed].sort((left, right) => left.start - right.start);
    for (let index = 1; index < ordered.length; index += 1) {
      const previous = ordered[index - 1];
      const current = ordered[index];
      if (!previous || !current) continue;
      // Next slot must start at/after previous end (+ gap). Overlap = 字叠字.
      expect(current.start).toBeGreaterThanOrEqual(previous.end + TRANSCRIPT_TURN_GAP_PX - 0.5);
    }
  });

  it('marks the live tail so the newest turn is not clip-locked', async () => {
    const turns = createTurns(8);
    const scrollElementRef: RefObject<HTMLDivElement | null> = { current: container };
    Object.defineProperties(container, {
      offsetHeight: { configurable: true, value: 640 },
      offsetWidth: { configurable: true, value: 900 },
      clientHeight: { configurable: true, value: 640 },
      scrollHeight: { configurable: true, value: 4_000 },
      scrollTop: { configurable: true, writable: true, value: 3_200 },
    });
    await act(async () => {
      root.render(
        <TranscriptScrollProvider sessionId="session-live-tail" scrollElementRef={scrollElementRef}>
          <TranscriptTurnList turns={turns} pinnedMessageId={null} renderTurn={renderTurn} />
        </TranscriptScrollProvider>,
      );
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
    });
    const slots = [
      ...container.querySelectorAll<HTMLElement>('[data-testid="transcript-turn-window-item"]'),
    ];
    expect(slots.length).toBeGreaterThan(0);
    const live = slots.filter((slot) => slot.classList.contains('is-live-tail'));
    expect(live).toHaveLength(1);
    expect(live[0]?.dataset.liveTail).toBe('true');
    expect(live[0]?.dataset.turnId ?? live[0]?.querySelector('[data-turn-id]')?.getAttribute('data-turn-id')).toBe(
      'turn-user-7',
    );
  });

  it('keeps an edited historical turn mounted and focused while the tail changes', async () => {
    const scrollElementRef: RefObject<HTMLDivElement | null> = { current: container };
    Object.defineProperties(container, {
      offsetHeight: { configurable: true, writable: true, value: 640 },
      offsetWidth: { configurable: true, writable: true, value: 900 },
      clientHeight: { configurable: true, writable: true, value: 640 },
      scrollHeight: { configurable: true, writable: true, value: 20_000 },
      scrollTop: { configurable: true, writable: true, value: 0 },
    });

    async function renderTurns(turns: TranscriptTurn[]): Promise<void> {
      await act(async () => {
        root.render(
          <TranscriptScrollProvider sessionId="session-edit" scrollElementRef={scrollElementRef}>
            <TranscriptTurnList
              turns={turns}
              pinnedMessageId="user-25"
              renderTurn={renderEditableTurn}
            />
          </TranscriptScrollProvider>,
        );
        await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
      });
    }

    await renderTurns(createTurns(50));
    const editor = container.querySelector<HTMLInputElement>('[data-testid="editor-user-25"]');
    expect(editor).not.toBeNull();
    act(() => editor?.focus());
    expect(document.activeElement).toBe(editor);

    await renderTurns(createTurns(51));
    expect(document.activeElement?.getAttribute('data-testid')).toBe('editor-user-25');
    expect(container.querySelector('[data-testid="editor-user-25"]')).not.toBeNull();
  });

  it('preserves exact mounted heights when another message changes structure', async () => {
    const turns = createTurns(2);
    turnHeightOverrides.set('turn-user-0', 6_000);
    turnHeightOverrides.set('turn-user-1', 900);
    const scrollElementRef: RefObject<HTMLDivElement | null> = { current: container };
    Object.defineProperties(container, {
      offsetHeight: { configurable: true, value: 640 },
      offsetWidth: { configurable: true, value: 900 },
      clientHeight: { configurable: true, value: 640 },
    });
    const committedHeights: string[] = [];
    const notifyContentGrew = (): void => {
      committedHeights.push(
        container.querySelector<HTMLElement>('.transcript-turn-window')?.style.height ?? '',
      );
    };
    const render = (nextTurns: TranscriptTurn[]): void => {
      root.render(
        <TranscriptScrollProvider sessionId="session-stable-measure" scrollElementRef={scrollElementRef}
          notifyContentGrew={notifyContentGrew}>
          <TranscriptTurnList turns={nextTurns} pinnedMessageId={null} renderTurn={renderTurn} />
        </TranscriptScrollProvider>,
      );
    };
    await act(async () => render(turns));

    // A restored pause/error or tool status changes structure, but the already
    // measured historical body has not resized and emits no new observer event.
    await act(async () => render(turns.map((turn) => ({
      ...turn,
      items: turn.items.map((item) => ({
        ...item,
        message: { ...item.message, status: 'streaming' },
      })),
    }))));

    const slots = container.querySelectorAll<HTMLElement>('.transcript-turn-window-item');
    expect(slots[0]?.style.height).toBe('6000px');
    expect(slots[1]?.style.height).toBe('900px');
    expect(container.querySelector<HTMLElement>('.transcript-turn-window')?.style.height)
      .toBe('6920px');
    expect(committedHeights.at(-1)).toBe('6920px');
  });

  it('does not let a detached turn body take over the key now at its index', async () => {
    const messages = (headId: string): ChatMessageUi[] =>
      [headId, 'user-1', 'user-2'].map((id) => ({
        id,
        role: 'user',
        text: id,
        thinking: '',
        tools: [],
        attachments: [],
        status: 'done',
      }));
    turnHeightOverrides.set('turn-user-old-head', 300);
    turnHeightOverrides.set('turn-user-new-head', 900);
    const scrollElementRef: RefObject<HTMLDivElement | null> = { current: container };
    Object.defineProperties(container, {
      offsetHeight: { configurable: true, value: 640 },
      offsetWidth: { configurable: true, value: 900 },
      clientHeight: { configurable: true, value: 640 },
    });
    const render = (headId: string): void => {
      root.render(
        <TranscriptScrollProvider sessionId="session-detached-body" scrollElementRef={scrollElementRef}>
          <TranscriptTurnList
            turns={groupTranscriptTurns(messages(headId))}
            pinnedMessageId={null}
            renderTurn={renderTurn}
          />
        </TranscriptScrollProvider>,
      );
    };
    await act(async () => render('user-old-head'));

    // A history page or bounded-window trim replaces the head turn in place:
    // the old body leaves the DOM still carrying data-index="0".
    await act(async () => render('user-new-head'));

    const body = container.querySelector<HTMLElement>(
      '[data-turn-id="turn-user-new-head"]',
    );
    if (!body) throw new Error('expected the new head turn to mount');
    expect(body.parentElement?.style.height).toBe('900px');
    expect(resizeObserverHarnesses.some((harness) => harness.targets.has(body))).toBe(true);
  });

  it('keeps the last real turn height while its pane is hidden', async () => {
    const turns = createTurns(2);
    turnHeightOverrides.set('turn-user-0', 900);
    const scrollElementRef: RefObject<HTMLDivElement | null> = { current: container };
    Object.defineProperties(container, {
      offsetHeight: { configurable: true, value: 640 },
      offsetWidth: { configurable: true, value: 900 },
      clientHeight: { configurable: true, value: 640 },
    });
    await act(async () => {
      root.render(
        <TranscriptScrollProvider sessionId="session-hidden-pane" scrollElementRef={scrollElementRef}>
          <TranscriptTurnList turns={turns} pinnedMessageId={null} renderTurn={renderTurn} />
        </TranscriptScrollProvider>,
      );
    });
    const body = container.querySelector<HTMLElement>('[data-turn-id="turn-user-0"]');
    if (!body) throw new Error('expected a mounted turn');
    expect(body.parentElement?.style.height).toBe('900px');
    const observer = resizeObserverHarnesses.find((harness) => harness.targets.has(body));
    if (!observer) throw new Error('expected a row resize observer');

    // display:none on the pane reports a zero box for every observed body.
    act(() => observer.callback([{
      target: body,
      borderBoxSize: [{ blockSize: 0, inlineSize: 0 }],
    } as unknown as ResizeObserverEntry], observer.observer));

    expect(body.parentElement?.style.height).toBe('900px');
  });

  it('does not restick the tail when a local fold asks for a remasure', async () => {
    const turns = createTurns(2);
    const scrollElementRef: RefObject<HTMLDivElement | null> = { current: container };
    Object.defineProperties(container, {
      offsetHeight: { configurable: true, value: 640 },
      offsetWidth: { configurable: true, value: 900 },
      clientHeight: { configurable: true, value: 640 },
    });
    let grew = 0;
    const notifyContentGrew = (): void => {
      grew += 1;
    };
    await act(async () => {
      root.render(
        <TranscriptScrollProvider
          sessionId="session-fold-measure"
          scrollElementRef={scrollElementRef}
          notifyContentGrew={notifyContentGrew}
        >
          <TranscriptTurnList turns={turns} pinnedMessageId={null} renderTurn={renderTurn} />
        </TranscriptScrollProvider>,
      );
    });
    const grewAfterMount = grew;
    const turnBody = container.querySelector<HTMLElement>('.transcript-turn-window-item-body');
    expect(turnBody).not.toBeNull();

    await act(async () => {
      document.dispatchEvent(
        new CustomEvent('piwin:transcript-turn-measure', { detail: { element: turnBody } }),
      );
    });

    expect(grew).toBe(grewAfterMount);
  });
});

describe('shouldAdjustTranscriptScrollOnItemSizeChange', () => {
  function createInstance(options: {
    scrollDirection: 'forward' | 'backward' | null;
    scrollOffset: number;
    measuredKeys?: Array<string | number>;
  }) {
    const itemSizeCache = new Map<string | number | bigint, number>();
    for (const key of options.measuredKeys ?? []) {
      itemSizeCache.set(key, 140);
    }
    return {
      scrollDirection: options.scrollDirection,
      scrollAdjustments: 0,
      scrollOffset: options.scrollOffset,
      itemSizeCache,
    };
  }

  it('compensates a fully above-fold first measure while scrolling into history', () => {
    expect(
      shouldAdjustTranscriptScrollOnItemSizeChange(
        { key: 'turn-older', start: 8_000, size: 140 },
        1_860,
        createInstance({ scrollDirection: 'backward', scrollOffset: 9_200 }),
        false,
      ),
    ).toBe(true);
  });

  it('still compensates an above-fold first measure while following the tail', () => {
    expect(
      shouldAdjustTranscriptScrollOnItemSizeChange(
        { key: 'turn-older', start: 8_000, size: 140 },
        1_860,
        createInstance({ scrollDirection: null, scrollOffset: 9_200 }),
        true,
      ),
    ).toBe(true);
  });

  it('does not restick a spanning first measure after the user has left the tail', () => {
    expect(
      shouldAdjustTranscriptScrollOnItemSizeChange(
        { key: 'turn-image', start: 8_600, size: 400 },
        304,
        createInstance({ scrollDirection: null, scrollOffset: 8_800 }),
        false,
      ),
    ).toBe(false);
  });

  it('compensates a fully above-fold first measure after the user has left the tail', () => {
    expect(
      shouldAdjustTranscriptScrollOnItemSizeChange(
        { key: 'turn-older', start: 7_200, size: 140 },
        304,
        createInstance({ scrollDirection: null, scrollOffset: 8_800 }),
        false,
      ),
    ).toBe(true);
  });

  it('preserves in-place reading when a history row above the fold remasures', () => {
    expect(
      shouldAdjustTranscriptScrollOnItemSizeChange(
        { key: 'turn-older', start: 2_000, size: 140 },
        80,
        createInstance({
          scrollDirection: null,
          scrollOffset: 8_800,
          measuredKeys: ['turn-older'],
        }),
        false,
      ),
    ).toBe(true);
  });

  it('compensates an above-fold re-measure while scrolling into history', () => {
    // A long reply's markdown settles after its first measure; the growth sits
    // entirely above the reader and must not shove them down the page.
    expect(
      shouldAdjustTranscriptScrollOnItemSizeChange(
        { key: 'turn-report', start: 2_000, size: 3_200 },
        9_800,
        createInstance({
          scrollDirection: 'backward',
          scrollOffset: 8_800,
          measuredKeys: ['turn-report'],
        }),
        false,
      ),
    ).toBe(true);
  });

  it('does not shift a spanning remasure (live tail growth) while following', () => {
    expect(
      shouldAdjustTranscriptScrollOnItemSizeChange(
        { key: 'turn-tail', start: 9_400, size: 600 },
        80,
        createInstance({
          scrollDirection: null,
          scrollOffset: 9_200,
          measuredKeys: ['turn-tail'],
        }),
        true,
      ),
    ).toBe(false);
  });
});

describe('transcript virtualization policy', () => {
  it('virtualizes any non-empty transcript so short heavy sessions stay windowed', () => {
    expect(shouldVirtualizeTranscript(0)).toBe(false);
    expect(shouldVirtualizeTranscript(1)).toBe(true);
    expect(shouldVirtualizeTranscript(3)).toBe(true);
    expect(shouldVirtualizeTranscript(12)).toBe(true);
    expect(shouldVirtualizeTranscript(20)).toBe(true);
    expect(shouldVirtualizeTranscript(21)).toBe(true);
    expect(shouldVirtualizeTranscript(200)).toBe(true);
    expect(TRANSCRIPT_VIRTUALIZATION_THRESHOLD).toBe(0);
  });

  it('range extractor still pins edit + live tail when virtualizer is re-enabled later', () => {
    const extractRange = createTranscriptRangeExtractor(30, 47);
    expect(extractRange({ startIndex: 4, endIndex: 6, overscan: 1, count: 50 })).toEqual([
      3, 4, 5, 6, 7, 30, 47, 48, 49,
    ]);
  });
});

describe('transcript streaming measure key', () => {
  it('stays empty while idle and changes when live text grows', () => {
    const turns = createTurns(2);
    expect(buildTranscriptStreamingMeasureKey(turns, false)).toBe('');
    const idle = buildTranscriptStreamingMeasureKey(turns, true);
    const grown: TranscriptTurn[] = turns.map((turn, index) =>
      index === turns.length - 1
        ? {
            ...turn,
            items: turn.items.map((item) => ({
              ...item,
              message: { ...item.message, text: `${item.message.text} more tokens` },
            })),
          }
        : turn,
    );
    expect(buildTranscriptStreamingMeasureKey(grown, true)).not.toBe(idle);
  });
});

describe('transcript virtualizer measure policy', () => {
  it('never defers ResizeObserver measure through rAF', () => {
    expect(transcriptVirtualizerMeasurePolicy()).toEqual({
      useAnimationFrameWithResizeObserver: false,
      useFlushSync: true,
    });
  });

  it('keeps the structure key stable when only live text grows', () => {
    const user: ChatMessageUi = {
      id: 'user-pause',
      role: 'user',
      text: 'continue',
      thinking: '',
      tools: [],
      attachments: [],
      status: 'done',
    };
    const streamingAssistant: ChatMessageUi = {
      id: 'assistant-live',
      role: 'assistant',
      text: 'first tokens',
      thinking: '',
      tools: [
        {
          toolCallId: 'bash-1',
          toolName: 'bash',
          status: 'running',
          output: '',
        },
      ],
      attachments: [],
      status: 'streaming',
    };
    const turns = groupTranscriptTurns([user, streamingAssistant]);
    const streamingKey = buildTranscriptTurnsStructureKey(turns);

    const grown = groupTranscriptTurns([
      user,
      { ...streamingAssistant, text: 'first tokens, more spit-out' },
    ]);
    expect(buildTranscriptTurnsStructureKey(grown)).toBe(streamingKey);

    const abortedTool: ChatMessageUi = {
      ...streamingAssistant,
      status: 'done',
      tools: [
        {
          toolCallId: 'bash-1',
          toolName: 'bash',
          status: 'error',
          output: 'Tool execution aborted',
        },
      ],
    };
    const errorRow: ChatMessageUi = {
      id: 'assistant-error',
      role: 'assistant',
      text: '',
      thinking: '',
      tools: [],
      attachments: [],
      status: 'done',
      failure: {
        code: 'unknown-agent-failure',
        origin: 'runtime',
        message: 'This operation was aborted',
        retriable: false,
      },
    };
    const afterPause = groupTranscriptTurns([user, abortedTool, errorRow]);
    expect(buildTranscriptTurnsStructureKey(afterPause)).not.toBe(streamingKey);
    expect(buildTranscriptTurnsStructureKey(afterPause)).not.toBe(buildTranscriptTurnsStructureKey(grown));
  });
});
