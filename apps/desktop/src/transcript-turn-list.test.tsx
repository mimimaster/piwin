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
  buildTranscriptTurnsStructureKey,
  transcriptVirtualizerMeasurePolicy,
} from './transcript-turn-list';
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

  it('windows a short heavy transcript instead of mounting every turn', async () => {
    const turns = createTurns(12);
    for (const turn of turns) {
      rememberTranscriptTurnHeight('session-short-heavy', turn.id, 2_000);
    }
    const scrollElementRef: RefObject<HTMLDivElement | null> = { current: container };
    Object.defineProperties(container, {
      offsetHeight: { configurable: true, writable: true, value: 640 },
      offsetWidth: { configurable: true, writable: true, value: 900 },
      clientHeight: { configurable: true, writable: true, value: 640 },
      scrollHeight: { configurable: true, writable: true, value: 28_000 },
      scrollTop: { configurable: true, writable: true, value: 27_000 },
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
    expect(mountedCount).toBeLessThan(12);
    expect(container.querySelector('#msg-user-11')).not.toBeNull();
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
});

describe('transcript virtualization policy', () => {
  it('virtualizes any non-empty transcript so short heavy sessions stay windowed', () => {
    expect(shouldVirtualizeTranscript(0)).toBe(false);
    expect(shouldVirtualizeTranscript(1)).toBe(true);
    expect(shouldVirtualizeTranscript(3)).toBe(true);
    expect(shouldVirtualizeTranscript(12)).toBe(true);
    expect(shouldVirtualizeTranscript(20)).toBe(true);
    expect(shouldVirtualizeTranscript(21)).toBe(true);
    expect(shouldVirtualizeTranscript(200, { streaming: true })).toBe(true);
    expect(shouldVirtualizeTranscript(200, { streaming: false })).toBe(true);
    expect(TRANSCRIPT_VIRTUALIZATION_THRESHOLD).toBe(0);
  });

  it('range extractor still pins edit + live tail when virtualizer is re-enabled later', () => {
    const extractRange = createTranscriptRangeExtractor(30, 47);
    expect(extractRange({ startIndex: 4, endIndex: 6, overscan: 1, count: 50 })).toEqual([
      3, 4, 5, 6, 7, 30, 47, 48, 49,
    ]);
  });
});

describe('transcript virtualizer measure policy', () => {
  it('never defers ResizeObserver measure through rAF', () => {
    expect(transcriptVirtualizerMeasurePolicy(false)).toEqual({
      useAnimationFrameWithResizeObserver: false,
      useFlushSync: false,
    });
    expect(transcriptVirtualizerMeasurePolicy(true)).toEqual({
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
