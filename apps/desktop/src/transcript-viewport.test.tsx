// @vitest-environment happy-dom
import { act, useLayoutEffect, useRef, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { TranscriptViewport } from './transcript-viewport';
import { clearTranscriptScrollPositionsForTests } from './transcript-scroll-memory';
import { PIWIN_APPEARANCE_DARK } from './appearance-tokens';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
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
      historyViewActive?: boolean;
      awaitingTranscript?: boolean;
      onReturnToLatest?: () => void;
      liveTurnId?: string;
      messageCount?: number;
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
            messages={[]}
            locale="en"
            canLoadOlder={options.canLoadOlder === true}
            historyViewActive={options.historyViewActive === true}
            awaitingTranscript={options.awaitingTranscript === true}
            liveTurnId={options.liveTurnId ?? null}
            {...(options.onLoadOlder ? { onLoadOlder: options.onLoadOlder } : {})}
            {...(options.onReturnToLatest ? { onReturnToLatest: options.onReturnToLatest } : {})}
          >
            <TranscriptGeometry scrollHeight={options.scrollHeight ?? 1_000} />
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

  it('loads an older page invisibly and preserves the visible scroll anchor', async () => {
    const onLoadOlder = vi.fn(async () => {
      const scrollElement = container.querySelector<HTMLDivElement>('.chat-stream');
      if (!scrollElement) throw new Error('Expected transcript scroll element');
      Object.defineProperty(scrollElement, 'scrollHeight', {
        configurable: true,
        value: 1_400,
      });
    });
    await renderSession('history-session', {
      scrollHeight: 1_000,
      canLoadOlder: true,
      onLoadOlder,
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
    expect(container.querySelector('[data-testid="jump-to-latest-btn"]')).not.toBeNull();
  });
});
