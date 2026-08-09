// @vitest-environment happy-dom
import { act, type ReactElement, type RefObject } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TranscriptScrollProvider, useTranscriptScrollPort } from './transcript-scroll-port';
import {
  createTranscriptRangeExtractor,
  shouldVirtualizeTranscript,
  TranscriptTurnList,
} from './transcript-turn-list';
import { groupTranscriptTurns, type TranscriptTurn } from './transcript-turns';
import type { ChatMessageUi } from './chat-reducer';

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

function JumpProbe(props: { messageIds: readonly string[] }): ReactElement {
  const scrollPort = useTranscriptScrollPort();
  return (
    <>
      {props.messageIds.map((messageId) => (
        <button
          key={messageId}
          type="button"
          data-testid={`jump-${messageId}`}
          onClick={() => scrollPort?.scrollToMessage(messageId)}
        >
          Jump
        </button>
      ))}
    </>
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
        const height = this.classList.contains('transcript-turn-window-item')
          ? ((turnId ? turnHeightOverrides.get(turnId) : undefined) ?? 120)
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

  it('keeps short transcripts fully mounted', () => {
    const turns = createTurns(10);
    act(() => {
      root.render(
        <TranscriptTurnList turns={turns} pinnedMessageId={null} renderTurn={renderTurn} />,
      );
    });

    expect(container.querySelectorAll('[data-testid="rendered-turn"]')).toHaveLength(10);
    expect(container.querySelector('[data-testid="transcript-turn-window"]')).toBeNull();
  });

  it('bounds mounted turn count and can jump to an initially unmounted turn', async () => {
    const turns = createTurns(500);
    const scrollElementRef: RefObject<HTMLDivElement | null> = { current: container };
    Object.defineProperties(container, {
      offsetHeight: { configurable: true, value: 640 },
      offsetWidth: { configurable: true, value: 900 },
      clientHeight: { configurable: true, value: 640 },
      scrollHeight: { configurable: true, value: 190_000 },
    });
    Object.defineProperty(container, 'scrollTo', {
      configurable: true,
      value: (options: ScrollToOptions): void => {
        container.scrollTop = typeof options.top === 'number' ? options.top : container.scrollTop;
      },
    });

    await act(async () => {
      root.render(
        <TranscriptScrollProvider sessionId="session-window" scrollElementRef={scrollElementRef}>
          <JumpProbe messageIds={['user-0', 'user-250', 'user-499']} />
          <TranscriptTurnList turns={turns} pinnedMessageId={null} renderTurn={renderTurn} />
        </TranscriptScrollProvider>,
      );
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
    });

    const initiallyMountedCount = container.querySelectorAll(
      '[data-testid="rendered-turn"]',
    ).length;
    expect(initiallyMountedCount).toBeGreaterThan(0);
    expect(initiallyMountedCount).toBeLessThan(20);
    expect(container.querySelector('#msg-user-250')).toBeNull();
    expect(container.querySelector('#msg-user-499')).toBeNull();

    async function jumpTo(messageId: string): Promise<void> {
      act(() => {
        container.querySelector<HTMLButtonElement>(`[data-testid="jump-${messageId}"]`)?.click();
      });
      await act(async () => {
        container.dispatchEvent(new Event('scroll'));
        await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
        await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
      });
    }

    await jumpTo('user-499');
    expect(container.scrollTop).toBeGreaterThan(0);
    expect(container.querySelector('#msg-user-499')).not.toBeNull();
    expect(container.querySelector('#msg-user-250')).toBeNull();

    await jumpTo('user-250');
    expect(container.querySelector('#msg-user-250')).not.toBeNull();
    expect(container.querySelector('#msg-user-0')).toBeNull();

    await jumpTo('user-0');
    expect(container.querySelector('#msg-user-0')).not.toBeNull();
    expect(container.querySelectorAll('[data-testid="rendered-turn"]').length).toBeLessThan(20);
  });

  it('keeps an edited historical turn mounted and focused while the tail changes', async () => {
    const scrollElementRef: RefObject<HTMLDivElement | null> = { current: container };
    Object.defineProperties(container, {
      offsetHeight: { configurable: true, value: 640 },
      offsetWidth: { configurable: true, value: 900 },
      clientHeight: { configurable: true, value: 640 },
      scrollHeight: { configurable: true, value: 200_000 },
    });

    async function renderTurns(turns: TranscriptTurn[]): Promise<void> {
      await act(async () => {
        root.render(
          <TranscriptScrollProvider sessionId="session-edit" scrollElementRef={scrollElementRef}>
            <TranscriptTurnList
              turns={turns}
              pinnedMessageId="user-250"
              renderTurn={renderEditableTurn}
            />
          </TranscriptScrollProvider>,
        );
        await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
      });
    }

    await renderTurns(createTurns(500));
    const editor = container.querySelector<HTMLInputElement>('[data-testid="editor-user-250"]');
    expect(editor).not.toBeNull();
    act(() => editor?.focus());
    expect(document.activeElement).toBe(editor);

    await renderTurns(createTurns(501));
    expect(document.activeElement?.getAttribute('data-testid')).toBe('editor-user-250');
    expect(container.querySelector('[data-testid="editor-user-250"]')).not.toBeNull();
  });

  it('remeasures a mounted turn after late content changes its height', async () => {
    const turns = createTurns(50);
    const scrollElementRef: RefObject<HTMLDivElement | null> = { current: container };
    Object.defineProperties(container, {
      offsetHeight: { configurable: true, value: 640 },
      offsetWidth: { configurable: true, value: 900 },
      clientHeight: { configurable: true, value: 640 },
      scrollHeight: { configurable: true, value: 20_000 },
    });

    await act(async () => {
      root.render(
        <TranscriptScrollProvider sessionId="session-resize" scrollElementRef={scrollElementRef}>
          <TranscriptTurnList turns={turns} pinnedMessageId={null} renderTurn={renderTurn} />
        </TranscriptScrollProvider>,
      );
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
    });

    const turnWindow = container.querySelector<HTMLDivElement>(
      '[data-testid="transcript-turn-window"]',
    );
    const firstTurn = container.querySelector<HTMLDivElement>(
      '.transcript-turn-window-item[data-turn-id="turn-user-0"]',
    );
    if (!turnWindow || !firstTurn) {
      throw new Error('Expected the virtual turn window and first measured turn');
    }
    const initialWindowHeight = Number.parseFloat(turnWindow.style.height);
    turnHeightOverrides.set('turn-user-0', 520);

    await act(async () => {
      for (const harness of resizeObserverHarnesses) {
        if (!harness.targets.has(firstTurn)) {
          continue;
        }
        harness.callback(
          [
            {
              target: firstTurn,
              contentRect: firstTurn.getBoundingClientRect(),
              borderBoxSize: [],
              contentBoxSize: [],
              devicePixelContentBoxSize: [],
            },
          ],
          harness.observer,
        );
      }
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
    });

    expect(Number.parseFloat(turnWindow.style.height)).toBeGreaterThan(initialWindowHeight + 300);
  });
});

describe('transcript virtualization policy', () => {
  it('activates only after the long-session threshold', () => {
    expect(shouldVirtualizeTranscript(40)).toBe(false);
    expect(shouldVirtualizeTranscript(41)).toBe(true);
  });

  it('keeps an editing turn mounted outside the visible range', () => {
    const extractRange = createTranscriptRangeExtractor(30);
    expect(extractRange({ startIndex: 4, endIndex: 6, overscan: 1, count: 50 })).toEqual([
      3, 4, 5, 6, 7, 30,
    ]);
  });
});
