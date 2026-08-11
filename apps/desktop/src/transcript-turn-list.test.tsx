// @vitest-environment happy-dom
import { act, type ReactElement, type RefObject } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TranscriptScrollProvider } from './transcript-scroll-port';
import {
  createTranscriptRangeExtractor,
  shouldVirtualizeTranscript,
  TRANSCRIPT_VIRTUALIZATION_THRESHOLD,
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

  it('keeps a long active transcript in document flow', async () => {
    const turns = createTurns(80);
    const scrollElementRef: RefObject<HTMLDivElement | null> = { current: container };

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

    expect(container.querySelector('[data-testid="transcript-turn-window"]')).toBeNull();
    expect(container.querySelectorAll('[data-testid="rendered-turn"]')).toHaveLength(80);
    expect(container.querySelector('#msg-user-0')).not.toBeNull();
    expect(container.querySelector('#msg-user-40')).not.toBeNull();
    expect(container.querySelector('#msg-user-79')).not.toBeNull();
  });

  it('bounds mounted rows for a completed long transcript', async () => {
    const turns = createTurns(500);
    const scrollElementRef: RefObject<HTMLDivElement | null> = { current: container };
    Object.defineProperties(container, {
      offsetHeight: { configurable: true, value: 640 },
      offsetWidth: { configurable: true, value: 900 },
      clientHeight: { configurable: true, value: 640 },
      scrollHeight: { configurable: true, value: 190_000 },
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

  it('keeps an edited historical turn mounted and focused while the tail changes', async () => {
    const scrollElementRef: RefObject<HTMLDivElement | null> = { current: container };
    Object.defineProperties(container, {
      offsetHeight: { configurable: true, value: 640 },
      offsetWidth: { configurable: true, value: 900 },
      clientHeight: { configurable: true, value: 640 },
      scrollHeight: { configurable: true, value: 20_000 },
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
});

describe('transcript virtualization policy', () => {
  it('virtualizes completed history only after the long-session threshold', () => {
    expect(shouldVirtualizeTranscript(0)).toBe(false);
    expect(shouldVirtualizeTranscript(40)).toBe(false);
    expect(shouldVirtualizeTranscript(41)).toBe(true);
    expect(shouldVirtualizeTranscript(200, { streaming: true })).toBe(false);
    expect(shouldVirtualizeTranscript(200, { streaming: false })).toBe(true);
    expect(TRANSCRIPT_VIRTUALIZATION_THRESHOLD).toBe(40);
  });

  it('range extractor still pins edit + live tail when virtualizer is re-enabled later', () => {
    const extractRange = createTranscriptRangeExtractor(30, 47);
    expect(extractRange({ startIndex: 4, endIndex: 6, overscan: 1, count: 50 })).toEqual([
      3, 4, 5, 6, 7, 30, 47, 48, 49,
    ]);
  });
});
