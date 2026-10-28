// @vitest-environment happy-dom
import { act, useLayoutEffect, useRef, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { TranscriptViewport } from './transcript-viewport';
import {
  clearTranscriptScrollPositionsForTests,
  rememberTranscriptScrollPosition,
} from './transcript-scroll-memory';
import type { ChatMessageUi } from './chat-reducer';
import { useTranscriptScrollPort, type TranscriptScrollPort } from './transcript-scroll-port';
import { PIWIN_APPEARANCE_DARK } from '../theme/appearance-tokens';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

/**
 * Message rows at fixed content offsets. happy-dom has no layout, so each
 * row's box is derived from the scroll position the way a browser would.
 */
function MessageRows(props: { offsets: Record<string, number> }): ReactElement {
  return (
    <>
      {Object.entries(props.offsets).map(([id, top]) => (
        <div
          key={id}
          id={`msg-${id}`}
          ref={(element) => {
            if (!element) return;
            element.getBoundingClientRect = () => {
              const stream = element.closest('.chat-stream');
              const y = top - (stream instanceof HTMLElement ? stream.scrollTop : 0);
              return { top: y, bottom: y + 80, left: 0, right: 800, width: 800, height: 80 } as DOMRect;
            };
          }}
        />
      ))}
    </>
  );
}

function ScrollPortProbe(props: { portRef: { current: TranscriptScrollPort | null } }): null {
  props.portRef.current = useTranscriptScrollPort();
  return null;
}

function TranscriptGeometry(props: { scrollHeight: number }): ReactElement {
  const markerRef = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const scrollElement = markerRef.current?.closest('.chat-stream');
    if (!(scrollElement instanceof HTMLDivElement)) {
      throw new Error('Expected the transcript scroll element');
    }
    Object.defineProperties(scrollElement, {
      clientHeight: { configurable: true, value: 200 },
      scrollHeight: { configurable: true, value: props.scrollHeight },
    });
    scrollElement.getBoundingClientRect = () =>
      ({ top: 0, bottom: 200, left: 0, right: 800, width: 800, height: 200 }) as DOMRect;
  }, [props.scrollHeight]);
  return (
    <div ref={markerRef} className="chat-turn-group is-current-response">
      Transcript content
    </div>
  );
}

describe('TranscriptViewport session scroll recovery', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    clearTranscriptScrollPositionsForTests();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  async function renderSession(
    sessionId: string,
    options: {
      activitySignal?: string;
      scrollHeight?: number;
      canLoadOlder?: boolean;
      onLoadOlder?: () => Promise<void>;
      canLoadNewer?: boolean;
      historyCaughtUp?: boolean;
      onLoadNewer?: () => Promise<void>;
      historyViewActive?: boolean;
      awaitingTranscript?: boolean;
      onReturnToLatest?: () => void;
      liveTurnId?: string;
      messageCount?: number;
      rows?: Record<string, number>;
      messages?: ChatMessageUi[];
      onSeekToMessage?: (messageId: string) => Promise<void>;
      portRef?: { current: TranscriptScrollPort | null };
    } = {},
  ): Promise<void> {
    await act(async () => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <TranscriptViewport
            key={sessionId}
            sessionId={sessionId}
            messageCount={options.messageCount ?? 1}
            activitySignal={options.activitySignal ?? 'idle'}
            messages={options.messages ?? []}
            locale="en"
            canLoadOlder={options.canLoadOlder === true}
            historyViewActive={options.historyViewActive === true}
            awaitingTranscript={options.awaitingTranscript === true}
            liveTurnId={options.liveTurnId ?? null}
            {...(options.canLoadNewer !== undefined ? { canLoadNewer: options.canLoadNewer } : {})}
            {...(options.historyCaughtUp !== undefined ? { historyCaughtUp: options.historyCaughtUp } : {})}
            {...(options.onLoadOlder ? { onLoadOlder: options.onLoadOlder } : {})}
            {...(options.onLoadNewer ? { onLoadNewer: options.onLoadNewer } : {})}
            {...(options.onReturnToLatest ? { onReturnToLatest: options.onReturnToLatest } : {})}
            {...(options.onSeekToMessage ? { onSeekToMessage: options.onSeekToMessage } : {})}
          >
            <TranscriptGeometry scrollHeight={options.scrollHeight ?? 1_000} />
            {options.rows ? <MessageRows offsets={options.rows} /> : null}
            {options.portRef ? <ScrollPortProbe portRef={options.portRef} /> : null}
          </TranscriptViewport>
        </PiwinUiProvider>,
      );
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
    });
  }

  async function finishOpening(): Promise<void> {
    // User gestures only begin once the covered initial layout is revealed.
    await act(async () => {
      await new Promise<void>((resolve) => window.setTimeout(resolve, 350));
    });
    expect(container.querySelector('[data-testid="transcript-opening-state"]')).toBeNull();
  }

  it('opens at the latest tail after switching sessions', async () => {
    await renderSession('session-a');
    const firstSessionElement = container.querySelector<HTMLDivElement>('.chat-stream');
    if (!firstSessionElement) {
      throw new Error('Expected the first transcript scroll element');
    }
    act(() => {
      firstSessionElement.scrollTop = 240;
      firstSessionElement.dispatchEvent(new Event('scroll'));
    });

    await renderSession('session-b');
    await renderSession('session-a');

    const restoredElement = container.querySelector<HTMLDivElement>('.chat-stream');
    expect(restoredElement?.scrollTop).toBe(1_000);
    expect(container.querySelector('[data-testid="jump-to-latest-btn"]')).toBeNull();
  });

  function chatMessage(id: string, role: ChatMessageUi['role']): ChatMessageUi {
    return { id, role, text: `${id} text`, thinking: '', tools: [], attachments: [], status: 'done' };
  }

  function streamElement(): HTMLDivElement {
    const element = container.querySelector<HTMLDivElement>('.chat-stream');
    if (!element) throw new Error('Expected the transcript scroll element');
    return element;
  }

  async function scrollReaderTo(scrollTop: number): Promise<void> {
    await act(async () => {
      const element = streamElement();
      element.scrollTop = scrollTop;
      element.dispatchEvent(new Event('scroll'));
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
    });
  }

  const READING_ROWS = { r1: 0, r2: 300, r3: 600, r4: 900 };

  it('reopens a session on the message the reader left it on', async () => {
    await renderSession('reading-a', { rows: READING_ROWS, messageCount: 4 });
    await finishOpening();
    // r2 starts 20px above the viewport top.
    await scrollReaderTo(320);

    await renderSession('reading-b', { rows: READING_ROWS, messageCount: 4 });
    await finishOpening();
    expect(streamElement().scrollTop).toBe(1_000);

    await renderSession('reading-a', { rows: READING_ROWS, messageCount: 4 });
    await finishOpening();
    expect(streamElement().scrollTop).toBe(320);
    expect(container.querySelector('[data-testid="jump-to-latest-btn"]')).not.toBeNull();
  });

  it('does not pull a returning reader to the tail for the turn that was already running', async () => {
    rememberTranscriptScrollPosition('running-session', {
      followTail: false,
      anchor: { messageId: 'r2', offset: 0 },
      lastSeenMessageId: null,
      lastUserMessageId: 'prompt-1',
    });
    await renderSession('running-session', { rows: READING_ROWS, messageCount: 4 });
    await finishOpening();
    expect(streamElement().scrollTop).toBe(300);

    await renderSession('running-session', {
      rows: READING_ROWS,
      messageCount: 4,
      liveTurnId: 'prompt-1',
      activitySignal: 'streaming-1',
    });
    expect(streamElement().scrollTop).toBe(300);

    // The reader's own new send still follows its reply.
    await renderSession('running-session', {
      rows: READING_ROWS,
      messageCount: 4,
      liveTurnId: 'prompt-2',
      activitySignal: 'streaming-2',
    });
    expect(streamElement().scrollTop).toBe(1_000);
  });

  it('counts messages that arrived after the reader left the tail', async () => {
    const first = [chatMessage('u1', 'user'), chatMessage('a1', 'assistant')];
    await renderSession('unseen-session', { messages: first, messageCount: 2 });
    await finishOpening();
    await scrollReaderTo(200);
    expect(container.querySelector('[data-testid="jump-to-latest-badge"]')).toBeNull();

    const grown = [...first, chatMessage('t1', 'tool'), chatMessage('u2', 'user'), chatMessage('a2', 'assistant')];
    await renderSession('unseen-session', { messages: grown, messageCount: 5 });
    const button = container.querySelector('[data-testid="jump-to-latest-btn"]');
    expect(container.querySelector('[data-testid="jump-to-latest-badge"]')?.textContent).toBe('2');
    expect(button?.getAttribute('aria-label')).toBe('Jump to latest (2 new)');

    act(() => (button as HTMLButtonElement | null)?.click());
    expect(container.querySelector('[data-testid="jump-to-latest-badge"]')).toBeNull();
  });

  it('seeks a remembered message that is no longer resident once the open refresh lands', async () => {
    rememberTranscriptScrollPosition('seek-session', {
      followTail: false,
      anchor: { messageId: 'old-7', offset: 0 },
      lastSeenMessageId: null,
      lastUserMessageId: null,
    });
    let finishSeek: () => void = () => {};
    const onSeekToMessage = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishSeek = resolve;
        }),
    );
    await renderSession('seek-session', {
      rows: READING_ROWS,
      messageCount: 4,
      awaitingTranscript: true,
      onSeekToMessage,
    });
    // The resume refresh would replace a history window, so no seek yet.
    expect(onSeekToMessage).not.toHaveBeenCalled();

    await renderSession('seek-session', { rows: READING_ROWS, messageCount: 4, onSeekToMessage });
    await act(async () => {
      await Promise.resolve();
    });
    expect(onSeekToMessage).toHaveBeenCalledWith('old-7');

    // The seek window commits before the Host request settles; the viewport
    // lands on the message as soon as it mounts.
    await renderSession('seek-session', {
      rows: { ...READING_ROWS, 'old-7': 450 },
      messageCount: 5,
      historyViewActive: true,
      onSeekToMessage,
    });
    expect(streamElement().scrollTop).toBe(450);
    await act(async () => {
      finishSeek();
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
    });
    expect(streamElement().scrollTop).toBe(450);
    expect(onSeekToMessage).toHaveBeenCalledOnce();
  });

  it('follows a growing tail but stays stable through 100 updates after scroll-away', async () => {
    await renderSession('live-session', { activitySignal: 'delta-0', scrollHeight: 1_000 });
    await finishOpening();
    const scrollElement = container.querySelector<HTMLDivElement>('.chat-stream');
    if (!scrollElement) {
      throw new Error('Expected the live transcript scroll element');
    }

    await renderSession('live-session', { activitySignal: 'delta-1', scrollHeight: 1_100 });
    expect(scrollElement.scrollTop).toBe(1_100);

    act(() => {
      scrollElement.scrollTop = 240;
      scrollElement.dispatchEvent(new Event('scroll'));
    });
    for (let deltaIndex = 2; deltaIndex <= 101; deltaIndex += 1) {
      await renderSession('live-session', {
        activitySignal: `delta-${deltaIndex}`,
        scrollHeight: 1_100 + deltaIndex * 10,
      });
    }

    expect(scrollElement.scrollTop).toBe(240);
    const jumpButton = container.querySelector('[data-testid="jump-to-latest-btn"]');
    expect(jumpButton).not.toBeNull();
    expect(jumpButton?.getAttribute('aria-label')).toBe('Jump to latest');
    expect(jumpButton?.querySelector('svg')).not.toBeNull();
  });

  it('keeps follow-tail when a programmatic stick fires mid-growth', async () => {
    await renderSession('artifact-session', { activitySignal: 'ah0', scrollHeight: 1_000 });
    const scrollElement = container.querySelector<HTMLDivElement>('.chat-stream');
    if (!scrollElement) {
      throw new Error('Expected the artifact transcript scroll element');
    }
    expect(scrollElement.scrollTop).toBe(1_000);

    // Artifact iframe grew; stick wrote scrollTop against the old height, then
    // content grew again before the next frame. The intermediate scroll event
    // must not abandon follow-tail.
    await act(async () => {
      Object.defineProperty(scrollElement, 'scrollHeight', {
        configurable: true,
        value: 1_600,
      });
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
    });

    expect(scrollElement.scrollTop).toBe(1_600);
    expect(container.querySelector('[data-testid="jump-to-latest-btn"]')).toBeNull();

    await act(async () => {
      Object.defineProperty(scrollElement, 'scrollHeight', {
        configurable: true,
        value: 2_200,
      });
      // Spurious scroll while still following — e.g. browser reflow.
      scrollElement.dispatchEvent(new Event('scroll'));
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
    });

    // Activity signal still drives a stick; follow-tail must remain on so the
    // next growth recovers rather than showing historical turns.
    await renderSession('artifact-session', { activitySignal: 'ah1', scrollHeight: 2_200 });
    expect(scrollElement.scrollTop).toBe(2_200);
    expect(container.querySelector('[data-testid="jump-to-latest-btn"]')).toBeNull();
  });

  it('gives the current response a minimum viewport and follows its growing floor', async () => {
    await renderSession('response-viewport-session', {
      activitySignal: 'streaming-0',
      scrollHeight: 1_400,
      liveTurnId: 'prompt-1',
    });
    const scrollElement = container.querySelector<HTMLDivElement>('.chat-stream');
    if (!scrollElement) throw new Error('Expected transcript scroll element');

    expect(scrollElement.style.getPropertyValue('--transcript-current-response-min-height')).toBe(
      '150px',
    );
    expect(scrollElement.scrollTop).toBe(1_400);
    expect(container.querySelector('[data-testid="jump-to-latest-btn"]')).toBeNull();

    await renderSession('response-viewport-session', {
      activitySignal: 'streaming-1',
      scrollHeight: 2_000,
      liveTurnId: 'prompt-1',
    });
    expect(scrollElement.scrollTop).toBe(2_000);
    expect(container.querySelector('[data-testid="jump-to-latest-btn"]')).toBeNull();
  });

  it('stays on the live tail when virtualizer measures grow after opening a session', async () => {
    await renderSession('cold-open-session', { activitySignal: 'open-0', scrollHeight: 800 });
    const scrollElement = container.querySelector<HTMLDivElement>('.chat-stream');
    if (!scrollElement) {
      throw new Error('Expected the transcript scroll element');
    }
    expect(scrollElement.scrollTop).toBe(800);

    await act(async () => {
      Object.defineProperty(scrollElement, 'scrollHeight', {
        configurable: true,
        value: 2_400,
      });
      scrollElement.scrollTop = 776;
      scrollElement.dispatchEvent(new Event('scroll'));
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
    });

    expect(scrollElement.scrollTop).toBe(2_400);
    expect(container.querySelector('[data-testid="jump-to-latest-btn"]')).toBeNull();
  });

  it('keeps a return-to-latest control visible for a bounded history view', async () => {
    const onReturnToLatest = vi.fn();
    await renderSession('history-focus-session', {
      historyViewActive: true,
      onReturnToLatest,
      scrollHeight: 300,
    });

    const button = container.querySelector<HTMLButtonElement>('[data-testid="jump-to-latest-btn"]');
    expect(button?.getAttribute('aria-label')).toBe('Return to latest messages');
    expect(button?.querySelector('svg')).not.toBeNull();
    act(() => button?.click());
    expect(onReturnToLatest).toHaveBeenCalledOnce();
  });

  it('keeps cached content visible while its authoritative snapshot refreshes', async () => {
    await renderSession('warm-session', { awaitingTranscript: true, messageCount: 3 });
    expect(container.querySelector('[data-testid="transcript-opening-state"]')).toBeNull();
    expect(container.querySelector('.chat-stream')?.getAttribute('aria-hidden')).toBe('false');
    expect(container.textContent).toContain('Transcript content');
  });

  it('shows one loading surface for a cold conversation until messages arrive', async () => {
    await renderSession('cold-session', { awaitingTranscript: true, messageCount: 0 });
    expect(container.querySelectorAll('[data-testid="transcript-opening-state"]')).toHaveLength(1);
    expect(container.textContent).toContain('Opening conversation');
  });

  it('does not cover or pin a history view while its transcript is awaiting data', async () => {
    await renderSession('history-awaiting-session', {
      historyViewActive: true,
      awaitingTranscript: true,
      scrollHeight: 1_000,
    });

    const scrollElement = container.querySelector<HTMLDivElement>('.chat-stream');
    if (!scrollElement) {
      throw new Error('Expected transcript scroll element');
    }
    expect(container.querySelector('[data-testid="transcript-opening-state"]')).toBeNull();
    expect(scrollElement.scrollTop).toBe(0);
  });

  it('does not stick to the live tail when an existing viewport enters history mode', async () => {
    await renderSession('history-toggle-session', {
      activitySignal: 'live-idle',
      scrollHeight: 1_000,
    });
    await finishOpening();
    const scrollElement = container.querySelector<HTMLDivElement>('.chat-stream');
    if (!scrollElement) {
      throw new Error('Expected transcript scroll element');
    }
    scrollElement.scrollTop = 240;

    await renderSession('history-toggle-session', {
      activitySignal: 'history-view',
      historyViewActive: true,
      scrollHeight: 1_000,
    });

    expect(scrollElement.scrollTop).toBe(240);
  });

  it('keeps the message on screen in place when an older page lands above it', async () => {
    const onLoadOlder = vi.fn(async () => undefined);
    await renderSession('history-session', {
      scrollHeight: 1_000,
      canLoadOlder: true,
      onLoadOlder,
      messageCount: 2,
      rows: { m2: 100 },
    });
    await finishOpening();
    const scrollElement = container.querySelector<HTMLDivElement>('.chat-stream');
    if (!scrollElement) throw new Error('Expected transcript scroll element');
    expect(container.querySelector('[data-testid="transcript-history-page-control"]')).toBeNull();
    scrollElement.scrollTop = 60;
    Object.defineProperty(scrollElement, 'clientHeight', {
      configurable: true,
      value: 400,
    });

    await act(async () => {
      scrollElement.dispatchEvent(new Event('scroll'));
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
    });
    expect(onLoadOlder).toHaveBeenCalled();

    // The page commits: m1 lands above and pushes m2 down by 400px.
    await renderSession('history-session', {
      scrollHeight: 1_400,
      canLoadOlder: true,
      onLoadOlder,
      messageCount: 3,
      rows: { m1: 100, m2: 500 },
    });

    expect(scrollElement.scrollTop).toBe(460);
  });

  it('auto-loads older history only when scrollable and near the top', async () => {
    const onLoadOlder = vi.fn(async () => undefined);
    await renderSession('auto-history-session', {
      scrollHeight: 2_000,
      canLoadOlder: true,
      onLoadOlder,
    });
    const scrollElement = container.querySelector<HTMLDivElement>('.chat-stream');
    if (!scrollElement) throw new Error('Expected transcript scroll element');
    Object.defineProperty(scrollElement, 'clientHeight', {
      configurable: true,
      value: 640,
    });
    Object.defineProperty(scrollElement, 'scrollHeight', {
      configurable: true,
      value: 2_000,
    });
    scrollElement.scrollTop = 0;

    await act(async () => {
      scrollElement.dispatchEvent(new Event('scroll'));
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    });

    expect(onLoadOlder).toHaveBeenCalled();
  });

  it('does not auto-load older pages while following the live tail', async () => {
    const onLoadOlder = vi.fn(async () => undefined);
    await renderSession('short-session', {
      scrollHeight: 300,
      canLoadOlder: true,
      onLoadOlder,
    });
    const scrollElement = container.querySelector<HTMLDivElement>('.chat-stream');
    if (!scrollElement) throw new Error('Expected transcript scroll element');
    Object.defineProperty(scrollElement, 'clientHeight', {
      configurable: true,
      value: 640,
    });
    Object.defineProperty(scrollElement, 'scrollHeight', {
      configurable: true,
      value: 300,
    });
    scrollElement.scrollTop = 0;

    await act(async () => {
      scrollElement.dispatchEvent(new Event('scroll'));
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    });

    expect(onLoadOlder).not.toHaveBeenCalled();
  });

  it('loads older history when the user wheels up on a fitted page that still has older pages', async () => {
    const onLoadOlder = vi.fn(async () => undefined);
    await renderSession('fitted-older-session', {
      scrollHeight: 180,
      canLoadOlder: true,
      onLoadOlder,
    });
    await finishOpening();
    const scrollElement = container.querySelector<HTMLDivElement>('.chat-stream');
    if (!scrollElement) throw new Error('Expected transcript scroll element');
    Object.defineProperty(scrollElement, 'clientHeight', {
      configurable: true,
      value: 640,
    });
    Object.defineProperty(scrollElement, 'scrollHeight', {
      configurable: true,
      value: 180,
    });
    expect(scrollElement.scrollHeight).toBeLessThanOrEqual(scrollElement.clientHeight);

    await act(async () => {
      scrollElement.dispatchEvent(new WheelEvent('wheel', { deltaY: -40, bubbles: true }));
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    });

    expect(onLoadOlder).toHaveBeenCalled();
    expect(container.querySelector('[data-testid="jump-to-latest-btn"]')).toBeNull();
  });

  async function wheelDownAtBottom(): Promise<void> {
    const scrollElement = container.querySelector<HTMLDivElement>('.chat-stream');
    if (!scrollElement) throw new Error('Expected transcript scroll element');
    Object.defineProperty(scrollElement, 'clientHeight', { configurable: true, value: 200 });
    Object.defineProperty(scrollElement, 'scrollHeight', { configurable: true, value: 1_000 });
    scrollElement.scrollTop = 800;
    await act(async () => {
      scrollElement.dispatchEvent(new WheelEvent('wheel', { deltaY: 40, bubbles: true }));
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    });
  }

  it('returns to the live tail when a caught-up history view is wheeled past its end', async () => {
    // The view already holds every row Host has and ends inside the live tail.
    // It is a frozen copy with run chrome suppressed: reading on must hand back
    // to live rather than strand the reader beside a running composer. While a
    // run streams, `canLoadNewer` stays true (an unpersisted live row differs
    // from the view's last id), so the hand-off keys off `historyCaughtUp`.
    const onReturnToLatest = vi.fn();
    const onLoadNewer = vi.fn(async () => undefined);
    await renderSession('caught-up-history-session', {
      historyViewActive: true,
      canLoadNewer: true,
      historyCaughtUp: true,
      onLoadNewer,
      onReturnToLatest,
      scrollHeight: 1_000,
    });
    await wheelDownAtBottom();

    expect(onReturnToLatest).toHaveBeenCalledOnce();
    expect(onLoadNewer).not.toHaveBeenCalled();
  });

  it('pages newer history instead of leaving a history view that still has newer rows', async () => {
    const onReturnToLatest = vi.fn();
    const onLoadNewer = vi.fn(async () => undefined);
    await renderSession('partial-history-session', {
      historyViewActive: true,
      canLoadNewer: true,
      historyCaughtUp: false,
      onLoadNewer,
      onReturnToLatest,
      scrollHeight: 1_000,
    });
    await wheelDownAtBottom();

    expect(onLoadNewer).toHaveBeenCalled();
    expect(onReturnToLatest).not.toHaveBeenCalled();
  });

  it('does not read a page landing\'s alignment drift as scrolling on to live', async () => {
    // Real capture: three older pages merged into a history view that already
    // contained the whole live tail, then anchor alignment nudged scrollTop a
    // few px downward. Read as "the reader went newer" it returned to live and
    // discarded the pages, so paging up looked locked at the newest place.
    const onReturnToLatest = vi.fn();
    const onLoadNewer = vi.fn(async () => undefined);
    const options = {
      historyViewActive: true,
      canLoadNewer: true,
      historyCaughtUp: true,
      onLoadNewer,
      onReturnToLatest,
      scrollHeight: 1_000,
    };
    await renderSession('landing-drift-session', { ...options, messageCount: 160 });
    await finishOpening();
    const scrollElement = container.querySelector<HTMLDivElement>('.chat-stream');
    if (!scrollElement) throw new Error('Expected transcript scroll element');
    Object.defineProperty(scrollElement, 'clientHeight', { configurable: true, value: 200 });
    Object.defineProperty(scrollElement, 'scrollHeight', { configurable: true, value: 1_000 });
    scrollElement.scrollTop = 780;

    await renderSession('landing-drift-session', { ...options, messageCount: 209 });
    scrollElement.scrollTop = 800;
    await act(async () => {
      scrollElement.dispatchEvent(new Event('scroll'));
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    });

    expect(onReturnToLatest).not.toHaveBeenCalled();
    expect(onLoadNewer).not.toHaveBeenCalled();
  });

  it('still hands back to live when the reader wheels on right after a page landed', async () => {
    const onReturnToLatest = vi.fn();
    const options = {
      historyViewActive: true,
      canLoadNewer: true,
      historyCaughtUp: true,
      onReturnToLatest,
      scrollHeight: 1_000,
    };
    await renderSession('wheel-after-landing-session', { ...options, messageCount: 160 });
    await finishOpening();
    await renderSession('wheel-after-landing-session', { ...options, messageCount: 209 });
    await wheelDownAtBottom();

    expect(onReturnToLatest).toHaveBeenCalledOnce();
  });

  it('stays in a caught-up history view until the reader actually scrolls on', async () => {
    // Landing on a recent query via the tick rail can already fit the window
    // to the tail. The jump itself must not bounce the reader back to live.
    const onReturnToLatest = vi.fn();
    await renderSession('landed-history-session', {
      historyViewActive: true,
      canLoadNewer: true,
      historyCaughtUp: true,
      onReturnToLatest,
      scrollHeight: 1_000,
    });
    await finishOpening();

    expect(onReturnToLatest).not.toHaveBeenCalled();
  });

  it('does not treat the live tail as a history view to leave', async () => {
    const onReturnToLatest = vi.fn();
    await renderSession('live-tail-session', {
      historyViewActive: false,
      historyCaughtUp: true,
      onReturnToLatest,
      scrollHeight: 1_000,
    });
    await finishOpening();
    await wheelDownAtBottom();

    expect(onReturnToLatest).not.toHaveBeenCalled();
  });

  it('never displays jump-to-latest button when messageCount is zero', async () => {
    await renderSession('empty-session', {
      messageCount: 0,
      historyViewActive: true,
      scrollHeight: 2_000,
    });
    expect(container.querySelector('[data-testid="jump-to-latest-btn"]')).toBeNull();
  });

  it('ignores wheel gestures on a fitted transcript that cannot scroll', async () => {
    await renderSession('fitted-session', { scrollHeight: 180 });
    const scrollElement = container.querySelector<HTMLDivElement>('.chat-stream');
    if (!scrollElement) {
      throw new Error('Expected the fitted transcript scroll element');
    }
    expect(scrollElement.scrollHeight).toBeLessThanOrEqual(scrollElement.clientHeight);

    act(() => {
      scrollElement.dispatchEvent(new WheelEvent('wheel', { deltaY: -120, bubbles: true }));
    });
    expect(container.querySelector('[data-testid="jump-to-latest-btn"]')).toBeNull();

    act(() => {
      scrollElement.dispatchEvent(new WheelEvent('wheel', { deltaY: 120, bubbles: true }));
    });
    expect(container.querySelector('[data-testid="jump-to-latest-btn"]')).toBeNull();
  });

  it('shows jump-to-latest after wheeling away on an overflowing transcript', async () => {
    await renderSession('overflow-wheel-session', { scrollHeight: 1_000 });
    const scrollElement = container.querySelector<HTMLDivElement>('.chat-stream');
    if (!scrollElement) {
      throw new Error('Expected the overflowing transcript scroll element');
    }

    act(() => {
      scrollElement.dispatchEvent(new WheelEvent('wheel', { deltaY: -80, bubbles: true }));
      // Far enough that the tail is out of view (viewport 200px, content 1000px).
      scrollElement.scrollTop = 300;
      scrollElement.dispatchEvent(new Event('scroll'));
    });
    expect(container.querySelector('[data-testid="jump-to-latest-btn"]')).not.toBeNull();
  });

  it('does not restick after the first near-bottom history scroll', async () => {
    await renderSession('near-bottom-scroll-session', { scrollHeight: 1_000 });
    await finishOpening();
    const scrollElement = container.querySelector<HTMLDivElement>('.chat-stream');
    if (!scrollElement) {
      throw new Error('Expected the overflowing transcript scroll element');
    }
    expect(scrollElement.scrollTop).toBe(1_000);

    act(() => {
      scrollElement.scrollTop = 960;
      scrollElement.dispatchEvent(new Event('scroll'));
    });
    expect(scrollElement.scrollTop).toBe(960);
    // The tail is still on screen: no button over the last card's actions.
    expect(container.querySelector('[data-testid="jump-to-latest-btn"]')).toBeNull();

    act(() => {
      scrollElement.scrollTop = 300;
      scrollElement.dispatchEvent(new Event('scroll'));
    });
    expect(container.querySelector('[data-testid="jump-to-latest-btn"]')).not.toBeNull();
  });
});
